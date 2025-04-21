import * as iam from "aws-cdk-lib/aws-iam";

import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  BucketProps,
} from "aws-cdk-lib/aws-s3";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import {
  DatabaseInstance,
  DatabaseInstanceEngine,
  DatabaseInstanceProps,
  PostgresEngineVersion,
  StorageType,
} from "aws-cdk-lib/aws-rds";
import {
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
  VpcProps,
} from "aws-cdk-lib/aws-ec2";
import { Queue, QueueProps } from "aws-cdk-lib/aws-sqs";
import { Secret, SecretProps } from "aws-cdk-lib/aws-secretsmanager";

import { Construct } from "constructs";

export interface SharedInfraStackProps extends StackProps {
  envName: string;
}

export class SharedInfraStack extends Stack {
  public readonly vpc: Vpc;
  public readonly dbSecret: Secret;
  public readonly trainingQueue: Queue;
  public readonly userPicsBucket: Bucket;
  public readonly appSg: SecurityGroup;
  public readonly lambdaSg: SecurityGroup;
  public readonly dbSg: SecurityGroup;

  constructor(scope: Construct, id: string, props: SharedInfraStackProps) {
    super(scope, id, props);
    const { envName } = props;
    const prefix = "Shared";

    // Network & SGs
    this.vpc = this.createVpc(prefix, envName);
    ({
      appSg: this.appSg,
      lambdaSg: this.lambdaSg,
      dbSg: this.dbSg,
    } = this.createSecurityGroups(prefix, envName));

    // Secret + RDS
    this.dbSecret = this.createDbSecret(prefix, envName);
    this.createPostgres(prefix, envName);

    // Buckets + replication
    ({ userPicsBucket: this.userPicsBucket } = this.createBuckets(
      prefix,
      envName
    ));

    // SQS
    this.trainingQueue = this.createQueue(prefix, envName);

    new CfnOutput(this, "PicsBucket", {
      value: this.userPicsBucket.bucketName,
    });
  }

  // -------- helpers ---------------------------------------------------
  private createVpc(
    prefix: string,
    env: string,
    overrides: Partial<VpcProps> = {}
  ): Vpc {
    return new Vpc(this, `${prefix}Vpc-${env}`, {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "private",
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      ...overrides,
    });
  }

  private createSecurityGroups(prefix: string, env: string) {
    const appSg = new SecurityGroup(this, `${prefix}AppSg-${env}`, {
      vpc: this.vpc,
    });
    const lambdaSg = new SecurityGroup(this, `${prefix}LambdaSg-${env}`, {
      vpc: this.vpc,
    });
    const dbSg = new SecurityGroup(this, `${prefix}DbSg-${env}`, {
      vpc: this.vpc,
      allowAllOutbound: false,
    });

    dbSg.addIngressRule(appSg, Port.tcp(5432), "App access");
    dbSg.addIngressRule(lambdaSg, Port.tcp(5432), "Lambda access");
    return { appSg, lambdaSg, dbSg };
  }

  private createDbSecret(
    prefix: string,
    env: string,
    overrides: Partial<SecretProps> = {}
  ): Secret {
    return new Secret(this, `${prefix}DbSecret-${env}`, {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "postgres" }),
        generateStringKey: "password",
        excludePunctuation: true,
      },
      ...overrides,
    });
  }

  private createPostgres(
    prefix: string,
    env: string,
    overrides: Partial<DatabaseInstanceProps> = {}
  ) {
    new DatabaseInstance(this, `${prefix}Postgres-${env}`, {
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_15_4,
      }),
      vpc: this.vpc,
      credentials: { password: this.dbSecret.secretValueFromJson("password") },
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: StorageType.GP3,
      multiAz: env === "prod",
      backupRetention: Duration.days(7),
      deletionProtection: env === "prod",
      securityGroups: [this.dbSg],
      removalPolicy:
        env === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      ...overrides,
    });
  }

  private createBuckets(
    prefix: string,
    env: string,
    overrides: Partial<BucketProps> = {}
  ) {
    const userPicsBucket = new Bucket(this, `${prefix}UserPics-${env}`, {
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy:
        env === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      ...overrides,
    });

    const backupBucket = new Bucket(this, `${prefix}Backup-${env}`, {
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy:
        env === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Replication
    const role = new iam.Role(this, `${prefix}ReplRole-${env}`, {
      assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
    });
    userPicsBucket.grantRead(role);
    backupBucket.grantReadWrite(role);
    userPicsBucket.addReplicationRule({
      role,
      destination: { bucket: backupBucket },
    });

    return { userPicsBucket, backupBucket };
  }

  private createQueue(
    prefix: string,
    env: string,
    overrides: Partial<QueueProps> = {}
  ): Queue {
    return new Queue(this, `${prefix}TrainingQueue-${env}`, {
      visibilityTimeout: Duration.minutes(5),
      retentionPeriod: Duration.days(4),
      ...overrides,
    });
  }
}
