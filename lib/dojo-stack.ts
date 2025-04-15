import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";

import { Construct } from "constructs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

interface DojoStackProps extends StackProps {
  vpc: Vpc;
  dbSecret: Secret;
  envName: string;
}

export class DojoStack extends Stack {
  constructor(scope: Construct, id: string, props: DojoStackProps) {
    super(scope, id, props);

    new Function(this, "DojoLambda", {
      runtime: Runtime.PYTHON_3_11,
      handler: "main.handler",
      code: Code.fromAsset("../dojo"),
      timeout: Duration.seconds(30),
      environment: {
        ENV: props.envName,
        DB_SECRET_ARN: props.dbSecret.secretArn,
      },
      vpc: props.vpc,
    });
  }
}
