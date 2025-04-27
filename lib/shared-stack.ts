import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";

import {
  AmazonLinuxCpuType,
  BastionHostLinux,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
  VpcProps,
} from "aws-cdk-lib/aws-ec2";
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
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  DatabaseInstanceProps,
  PostgresEngineVersion,
  StorageType,
} from "aws-cdk-lib/aws-rds";
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
  public readonly codeBucket: Bucket;
  public readonly appSg: SecurityGroup;
  public readonly lambdaSg: SecurityGroup;
  public readonly dbSg: SecurityGroup;
  public readonly albSg: SecurityGroup;
  public readonly dbInstance: DatabaseInstance;
  public readonly bastion: BastionHostLinux;
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
      albSg: this.albSg,
    } = this.createSecurityGroups(prefix, envName));

    ({ bastion: this.bastion } = this.createBastion(prefix, envName));

    // Secret + RDS
    this.dbSecret = this.createDbSecret(prefix, envName);
    this.dbSecret.grantRead(this.bastion.instance);
    this.dbInstance = this.createPostgres(prefix, envName);

    // Buckets + replication
    ({ userPicsBucket: this.userPicsBucket } = this.createBuckets(
      prefix,
      envName
    ));

    // SQS
    this.trainingQueue = this.createQueue(prefix, envName);

    // Code bucket
    this.codeBucket = this.createCodeBucket(prefix, envName);

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
    const albSg = new SecurityGroup(this, `${prefix}AlbSg-${env}`, {
      vpc: this.vpc,
    });
    albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(80));
    dbSg.addIngressRule(appSg, Port.tcp(5432), "App access");
    dbSg.addIngressRule(lambdaSg, Port.tcp(5432), "Lambda access");
    appSg.addIngressRule(albSg, Port.tcp(3000), "ALB to App access");
    return { appSg, lambdaSg, dbSg, albSg };
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
  ): DatabaseInstance {
    const defaultInstanceType =
      env === "prod"
        ? InstanceType.of(InstanceClass.M5, InstanceSize.LARGE)
        : InstanceType.of(InstanceClass.T3, InstanceSize.MICRO);

    return new DatabaseInstance(this, `${prefix}Postgres-${env}`, {
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_17_4,
      }),
      vpc: this.vpc,
      credentials: Credentials.fromSecret(this.dbSecret),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: StorageType.GP3,
      instanceType: defaultInstanceType,
      multiAz: env === "prod",
      backupRetention: Duration.days(7),
      deletionProtection: env === "prod",
      securityGroups: [this.dbSg],
      publiclyAccessible: env !== "prod",
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
    // 1. Create buckets
    const userPicsBucket = new Bucket(this, `${prefix}UserPics-${env}`, {
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(env === "prod" ? 90 : 7),
        },
      ],
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

    // 2. Enable versioning on the source bucket
    const enableVersioningResource = new cr.AwsCustomResource(
      this,
      `${prefix}EnableVersioning-${env}`,
      {
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["s3:PutBucketVersioning"],
            resources: [`arn:aws:s3:::${userPicsBucket.bucketName}`],
          }),
        ]),
        onCreate: {
          service: "S3",
          action: "putBucketVersioning",
          parameters: {
            Bucket: userPicsBucket.bucketName,
            VersioningConfiguration: {
              Status: "Enabled",
            },
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `${prefix}${userPicsBucket.bucketName}-versioning-${env}`
          ),
        },
      }
    );

    // 3. Grant the role permissions to replicate to the destination bucket
    const role = new iam.Role(this, `${prefix}ReplRole-${env}`, {
      assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
    });
    userPicsBucket.grantRead(role);
    backupBucket.grantReadWrite(role);

    // 4. Configure replication using a custom resource
    const configureReplicationResource = new cr.AwsCustomResource(
      this,
      `${prefix}ConfigureReplication-${env}`,
      {
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: [
              "s3:PutBucketReplication",
              "s3:GetBucketReplication",
              "s3:DeleteBucketReplication",
              "s3:PutReplicationConfiguration",
              "s3:GetReplicationConfiguration",
            ],
            resources: [`arn:aws:s3:::${userPicsBucket.bucketName}`],
          }),
          new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [role.roleArn],
          }),
        ]),
        onCreate: {
          service: "S3",
          action: "putBucketReplication",
          parameters: {
            Bucket: userPicsBucket.bucketName,
            ReplicationConfiguration: {
              Role: role.roleArn,
              Rules: [
                {
                  Status: "Enabled",
                  Prefix: "", // Replicate all objects
                  Destination: {
                    Bucket: backupBucket.bucketArn,
                  },
                },
              ],
            },
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            userPicsBucket.bucketName
          ),
        },
      }
    );

    configureReplicationResource.node.addDependency(enableVersioningResource);

    return { userPicsBucket, backupBucket };
  }

  private createQueue(
    prefix: string,
    env: string,
    overrides: Partial<QueueProps> = {}
  ): Queue {
    const dlq = new Queue(this, `${prefix}TrainingDLQ-${env}`, {
      retentionPeriod: Duration.days(14),
    });

    const trainingQueue = new Queue(this, `${prefix}TrainingQueue-${env}`, {
      visibilityTimeout: Duration.minutes(5),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: dlq,
      },
      ...overrides,
    });

    return trainingQueue;
  }

  private createCodeBucket(prefix: string, env: string): Bucket {
    return new Bucket(this, `${prefix}CodeBucket-${env}`, {
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  private createBastion(prefix: string, env: string) {
    const bastionSg = new SecurityGroup(this, `${prefix}BastionSg-${env}`, {
      vpc: this.vpc,
    });

    // Let the bastion reach Postgres
    this.dbSg.addIngressRule(bastionSg, Port.tcp(5432), "Bastion to Postgres");

    const bastion = new BastionHostLinux(this, `${prefix}Bastion-${env}`, {
      vpc: this.vpc,
      subnetSelection: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
      securityGroup: bastionSg,
      // AmazonLinux 2023 (SSM agent pre-installed)
      machineImage: MachineImage.latestAmazonLinux2023({
        cpuType: AmazonLinuxCpuType.ARM_64,
      }),
    });

    // SSM role is added automatically by BastionHostLinux
    new CfnOutput(this, `${prefix}BastionId-${env}`, {
      value: bastion.instanceId,
    });

    return { bastion, bastionSg };
  }
}
