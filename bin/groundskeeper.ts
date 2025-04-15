import * as cdk from "aws-cdk-lib";

import { DojoStack } from "../lib/dojo-stack";
import { SharedInfraStack } from "../lib/shared-stack";
import { UsainStack } from "../lib/usain-stack";

const app = new cdk.App();

const env = app.node.tryGetContext("env") || "dev";

const shared = new SharedInfraStack(app, `SharedInfra-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

new DojoStack(app, `DojoStack-${env}`, {
  vpc: shared.vpc,
  dbSecret: shared.dbSecret,
  envName: env,
});

new UsainStack(app, `UsainStack-${env}`, {
  vpc: shared.vpc,
  dbSecret: shared.dbSecret,
  envName: env,
});
