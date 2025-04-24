import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  Duration,
  Stack,
  StackProps,
  aws_events as events,
  aws_events_targets as targets,
} from "aws-cdk-lib";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";

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
  
    const worker = this.createLambda("DojoWorker", props);

    new events.Rule(this, "DojoCleanupCron", {
      schedule: events.Schedule.cron({ minute: "0", hour: "2" }),
      targets: [new targets.LambdaFunction(worker)],
    });
  }

  private createLambda(
    prefix: string,
    props: DojoStackProps
  ): Function {
    const fn = new Function(this, `${prefix}-${props.envName}`, {
      runtime: Runtime.NODEJS_18_X,
      code: Code.fromBucket(props.codeBucket, "dojo-worker.zip"),
      handler: "dist/handler.handler",
      memorySize: 512,
      timeout: Duration.minutes(5),
      vpc: props.vpc,
      securityGroups: [props.lambdaSg],
      environment: {
        QUEUE_URL: props.queue.queueUrl,
        DB_SECRET_ARN: props.dbSecret.secretArn,
      },
    });

    fn.addEventSource(new SqsEventSource(props.queue, { batchSize: 5 }));
    props.queue.grantConsumeMessages(fn);
    props.dbSecret.grantRead(fn);

    return fn;
  }
}
