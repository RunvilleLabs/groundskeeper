# 🧹 Groundskeeper

Groundskeeper is the AWS CDK project that sets up and maintains the infrastructure for our endurance platform. Like a real race-day groundskeeper, it ensures the track is clean, safe, and ready for action.

It sets up all the foundational services powering:

- 🧠 Dojo – our training plan generation engine
- 🧴 Usain – our backend API (Express/TypeScript)
- 🌍 All shared resources – RDS, VPC, Secrets, networking, etc.

---

## 💡 What Needs to Be Implemented

This CDK project should provision **all core infrastructure**, with dev/prod environment support.

---

shared: [vpc, security groups, subnets], rds, secrets (db creds, api keys, openai keys)
usain: ecs (usain), fargate (usain), ecr (docker images host)
dojo: sqs, dynamo (maybe?), lambda, eventbridge, apigateway (optional)
dashboard-stack: Cloudwatch dashboards, cloudwatch alarms

How to use Bastion:

First install and configure:

```
brew install awscli session-manager-plugin
aws configure   # or use AWS_PROFILE / AWS_REGION env vars
```

For dev bastion:

```
aws ssm start-session --target i-00acf13221ce04155 # for dev bastion
db # this command will fire up connection to postgress
```

For prod:

```
aws ssm start-session --target i-02d73d01d5defbcaf # for prod bastion
dbprod
```

If problems with db command run:

```
sudo dnf install -y postgresql17
sudo tee /usr/local/bin/db >/dev/null <<'EOF'
#!/bin/bash
set -euo pipefail

# Hard-code your secret name (or ARN) here:
SECRET_ID="SharedDbSecretdevBAE9EFEA-cH0P0qQkCBmA"

JSON=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" \
       --query SecretString --output text)

export PGHOST=$(echo "$JSON" | jq -r .host)
export PGUSER=$(echo "$JSON" | jq -r .username)
export PGPASSWORD=$(echo "$JSON" | jq -r .password)
export PGDATABASE=${PGDATABASE:-postgres}

if [ $# -eq 0 ]; then
  exec psql          # interactive shell
else
  exec "$@"          # run whatever CLI you passed
fi
EOF

sudo chmod +x /usr/local/bin/db
echo "✅ Wrapper fixed — type 'db' to connect."
```
