import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  Duration,
  Stack,
  StackProps,
  aws_events as events,
  aws_events_targets as targets,
} from "aws-cdk-lib";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

import { Construct } from "constructs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Bucket } from "aws-cdk-lib/aws-s3";

export interface DojoStackProps extends StackProps {
  envName: string;
  vpc: Vpc;
  queue: Queue;
  dbSecret: Secret;
  lambdaSg: SecurityGroup;
  codeBucket: Bucket;
}

export class DojoStack extends Stack {
  constructor(scope: Construct, id: string, props: DojoStackProps) {
    super(scope, id, props);
  
    const logGroup = this.createLogGroup("Dojo", props.envName);
    const worker = this.createLambda("DojoWorker", props, logGroup);

    new events.Rule(this, "DojoCleanupCron", {
      schedule: events.Schedule.cron({ minute: "0", hour: "2" }),
      targets: [new targets.LambdaFunction(worker)],
    });
  }

  private createLambda(
    prefix: string,
    props: DojoStackProps,
    logGroup: LogGroup
  ): Function {
    const usainAppSecret = Secret.fromSecretNameV2(
      this,
      "UsainAppSecret",
      `UsainAppSecret-${props.envName}`
    );

    const fn = new Function(this, `${prefix}-${props.envName}`, {
      runtime: Runtime.NODEJS_18_X,
      code: Code.fromBucket(props.codeBucket, "dojo-worker.zip"),
      handler: "dist/handler.handler",
      memorySize: 512,
      timeout: Duration.minutes(5),
      vpc: props.vpc,
      securityGroups: [props.lambdaSg],
      logGroup: logGroup,
      environment: {
        QUEUE_URL: props.queue.queueUrl,
        DB_SECRET_ARN: props.dbSecret.secretArn,
        USAIN_BASE_URL: usainAppSecret.secretValueFromJson("USAIN_BASE_URL").toString(),
      },
    });

    fn.addEventSource(new SqsEventSource(props.queue, { batchSize: 5 }));
    props.queue.grantConsumeMessages(fn);
    props.dbSecret.grantRead(fn);
    usainAppSecret.grantRead(fn);
    logGroup.grantWrite(fn);

    return fn;
  }

  private createLogGroup(prefix: string, env: string): LogGroup {
    return new LogGroup(this, `${prefix}LogGroup-${env}`, {
      logGroupName: `/aws/lambda/DojoWorker-${env}`,
      retention: env === 'dev' ? RetentionDays.ONE_WEEK : RetentionDays.ONE_MONTH,
    });
  }
}
