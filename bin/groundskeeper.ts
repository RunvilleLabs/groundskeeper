import * as cdk from "aws-cdk-lib";

import { DojoStack } from "../lib/dojo-stack";
import { SharedInfraStack } from "../lib/shared-stack";
import { UsainStack } from "../lib/usain-stack";

const app = new cdk.App();
const envName = app.node.tryGetContext("env") ?? "dev";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

// ── Shared core infra ─────────────────────────────────────────
const shared = new SharedInfraStack(app, `SharedInfra-${envName}`, {
  envName,
  env,
});

// ── Dojo (Lambda) stack ───────────────────────────────────────
new DojoStack(app, `DojoStack-${envName}`, {
  envName,
  vpc: shared.vpc,
  queue: shared.trainingQueue,
  dbSecret: shared.dbSecret,
  lambdaSg: shared.lambdaSg,
  codeBucket: shared.codeBucket,
  env,
});

// ── Usain (Express ECS) stack ─────────────────────────────────
new UsainStack(app, `UsainStack-${envName}`, {
  envName,
  vpc: shared.vpc,
  queue: shared.trainingQueue,
  dbSecret: shared.dbSecret,
  userPicsBucket: shared.userPicsBucket,
  appSg: shared.appSg,
  albSg: shared.albSg,
  dbInstance: shared.dbInstance,
  env,
});