import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
} from "aws-cdk-lib/aws-rds";
import { Stack, StackProps } from "aws-cdk-lib";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";

import { Construct } from "constructs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

export class SharedInfraStack extends Stack {
  public readonly vpc: Vpc;
  public readonly dbSecret: Secret;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, "AppVpc", {
      maxAzs: 2,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC },
        { name: "private", subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      ],
    });

    this.dbSecret = new Secret(this, "PostgresSecret", {
      secretName: "postgresCredentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "postgres" }),
        generateStringKey: "password",
      },
    });

    new DatabaseInstance(this, "PostgresDB", {
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.V15,
      }),
      vpc: this.vpc,
      credentials: {
        username: "postgres",
        password: this.dbSecret.secretValueFromJson("password"),
      },
      databaseName: "usain",
      publiclyAccessible: false,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
    });
  }
}
