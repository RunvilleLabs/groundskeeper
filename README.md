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
