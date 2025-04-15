import { Cluster, ContainerImage, FargateService } from "aws-cdk-lib/aws-ecs";
import { Stack, StackProps } from "aws-cdk-lib";

import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { Construct } from "constructs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Vpc } from "aws-cdk-lib/aws-ec2";

interface UsainStackProps extends StackProps {
  vpc: Vpc;
  dbSecret: Secret;
  envName: string;
}

export class UsainStack extends Stack {
  constructor(scope: Construct, id: string, props: UsainStackProps) {
    super(scope, id, props);

    const cluster = new Cluster(this, "UsainCluster", {
      vpc: props.vpc,
    });

    new ApplicationLoadBalancedFargateService(this, "UsainFargate", {
      cluster,
      taskImageOptions: {
        image: ContainerImage.fromAsset("../usain"),
        environment: {
          ENV: props.envName,
          DB_SECRET_ARN: props.dbSecret.secretArn,
        },
      },
      publicLoadBalancer: true,
    });
  }
}
