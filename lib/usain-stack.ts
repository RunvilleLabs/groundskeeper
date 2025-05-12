import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
} from "aws-cdk-lib/aws-ecs";
import {
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_ecr as ecr,
} from "aws-cdk-lib";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";

import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { DatabaseInstance } from "aws-cdk-lib/aws-rds";

export interface UsainStackProps extends StackProps {
  envName: string;
  vpc: Vpc;
  queue: Queue;
  dbSecret: Secret;
  userPicsBucket: Bucket;
  appSg: SecurityGroup;
  albSg: SecurityGroup;
  dbInstance: DatabaseInstance;
}

export class UsainStack extends Stack {
  constructor(scope: Construct, id: string, props: UsainStackProps) {
    super(scope, id, props);
    const { envName } = props;
    const prefix = "Usain";

    // ECS Cluster
    const appSecret = this.createAppSecret(prefix, envName);
    const cluster = this.createCluster(prefix, envName, props.vpc);
    const repo = this.createRepo(prefix, envName);
    const taskDef = this.createTaskDef(prefix, envName, repo, props, appSecret);
    const svc = this.createService(prefix, envName, cluster, taskDef, props, appSecret);
    this.attachAlb(prefix, envName, svc, props);
  }

  // ---- helpers -------------------------------------------------------
  private createCluster(prefix: string, env: string, vpc: Vpc): Cluster {
    return new Cluster(this, `${prefix}Cluster-${env}`, { vpc });
  }

  private createRepo(prefix: string, env: string): ecr.Repository {
    return new ecr.Repository(this, `${prefix}Repo-${env}`, {
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  private createAppSecret(prefix: string, env: string): Secret {
    return new Secret(this, `${prefix}AppSecret-${env}`, {
      secretName: `${prefix}AppSecret-${env}`,
      description: `Manually created secret for ${prefix}`,
    });
  }

  private createTaskDef(
    prefix: string,
    env: string,
    repo: ecr.Repository,
    props: UsainStackProps,
    appSecret: Secret
  ): FargateTaskDefinition {
    const td = new FargateTaskDefinition(this, `${prefix}Task-${env}`, {
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    td.addContainer("web", {
      image: ContainerImage.fromEcrRepository(repo, env),
      logging: LogDriver.awsLogs({ streamPrefix: "usain" }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: env,
        TRAINING_QUEUE_URL: props.queue.queueUrl,
        USER_PICS_BUCKET: props.userPicsBucket.bucketName,
      },
      secrets: {
        POSTGRES_USER: ecs.Secret.fromSecretsManager(props.dbSecret),
        POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(props.dbSecret),
        JWT_SECRET: ecs.Secret.fromSecretsManager(appSecret, "JWT_SECRET"),
        GOOGLE_CLIENT_WEB_ID: ecs.Secret.fromSecretsManager(appSecret, "GOOGLE_CLIENT_WEB_ID"),
        GOOGLE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(appSecret, "GOOGLE_CLIENT_SECRET"),
        APPLE_CLIENT_ID: ecs.Secret.fromSecretsManager(appSecret, "APPLE_CLIENT_ID"),
        APPLE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(appSecret, "APPLE_CLIENT_SECRET"),
        APPLE_REDIRECT_URI: ecs.Secret.fromSecretsManager(appSecret, "APPLE_REDIRECT_URI"),
        GOOGLE_ANDROID_CLIENT_ID: ecs.Secret.fromSecretsManager(appSecret, "GOOGLE_ANDROID_CLIENT_ID"),
        GMAIL_SENDER: ecs.Secret.fromSecretsManager(appSecret, "GMAIL_SENDER"),
        GMAIL_REFRESH_TOKEN: ecs.Secret.fromSecretsManager(appSecret, "GMAIL_REFRESH_TOKEN"),
        GMAIL_REDIRECT_URI: ecs.Secret.fromSecretsManager(appSecret, "GMAIL_REDIRECT_URI"),
        FIT_S3_BUCKET_NAME: ecs.Secret.fromSecretsManager(appSecret, "FIT_S3_BUCKET_NAME")
      },
    });

    return td;
  }

  private createService(
    prefix: string,
    env: string,
    cluster: Cluster,
    taskDef: FargateTaskDefinition,
    props: UsainStackProps,
    appSecret: Secret
  ): FargateService {
    const service = new FargateService(this, `${prefix}Service-${env}`, {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 0,
      assignPublicIp: false,
      securityGroups: [props.appSg],
      circuitBreaker: { rollback: true },
    });

    const scaling = service.autoScaleTaskCount({ maxCapacity: 4 });
    scaling.scaleOnCpuUtilization("Cpu70", {
      targetUtilizationPercent: 70,
      scaleOutCooldown: Duration.minutes(2),
      scaleInCooldown: Duration.minutes(5),
    });

    props.queue.grantSendMessages(service.taskDefinition.taskRole);
    props.dbSecret.grantRead(service.taskDefinition.taskRole);
    props.userPicsBucket.grantReadWrite(service.taskDefinition.taskRole);
    appSecret.grantRead(service.taskDefinition.taskRole);
    return service;
  }

  private attachAlb(
    prefix: string,
    env: string,
    service: FargateService,
    props: UsainStackProps
  ) {
    const alb = new elbv2.ApplicationLoadBalancer(this, `${prefix}Alb-${env}`, {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSg,
    });

    const listener = alb.addListener("Http", { port: 80, open: true });
    listener.addTargets("ECS", {
      port: 80,
      targets: [
        service.loadBalancerTarget({
          containerName: "web",
          containerPort: 3000,
        }),
      ],
      healthCheck: { path: "/health", interval: Duration.seconds(30) },
    });
  }
}
