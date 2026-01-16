# Shibboleth service-provider "@edge"

This is a sample project for the implementation of a shibboleth service provider in a [lambda@edge](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-the-edge.html) function.
All http requests go through a [cloudfront distribution](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-overview.html) which first passes them through the function to determine authentication status.
The request is processed by the lambda function using the [shibboleth-sp](https://www.npmjs.com/package/shibboleth-sp) library to either verify authenticated status or drive the authentication process with the shibboleth IDP to get authenticated before passing through to the targeted [origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html).

### Stack overview

![diagram1](./docs/diagram.png)

- **Origin request lambda function:**
  This is where the bulk of the work is done. The service provider functionality resides here. Each incoming request has its headers checked for a valid authentication token (jwt) before passing through to the origin. If the token is missing or expired, the saml authentication flow with the shibboleth IDP is started.
  
    >NOTE: This functionality should belong in a viewer request edge lambda, where every request would be processed, despite what's in the cache. However, the 1 MB limit for viewer request lambda code is exceeded, leaving the only choice of origin request lambda with a 50 MB code limit. In order to get the lambda hit for EVERY request, caching is disabled. PENDING A WORKAROUND AS CACHE DISABLING IS JUST AN ESCAPE HATCH.
  
- **Viewer response lambda function:**
  This function merely switches the content-type of the outgoing response from `application/json` to `text/html` 

- **Origin ("App") lambda function:**
  This application that authentication grants access to. In this case a simple lambda function.
  Outside of this simple demo stack, this might be something more conventional, like a container cluster fronted by a load balancer.

### Authentication flow:

A more detailed view of the interaction between the end-user, origin request lambda, and app is depicted in the following diagram:

![diagram2](./docs/diagram2.png)

### Prerequisites

1. **[AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html) Installed**: Make sure you have the AWS CDK installed on your local machine. You can install it using npm:

   ```bash
   npm install -g aws-cdk
   ```

2. **[AWS CLI](https://aws.amazon.com/cli/) Configured**: Ensure that the AWS CLI is installed and configured with the necessary credentials to access your AWS account.

3. **[Node.js](https://nodejs.org/en/download) Installed**: The AWS CDK requires Node.js. Make sure you have Node.js installed on your machine.

4. **[Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) Installed**: Ensure that Git is installed on your local machine to clone repositories.

5. **Access to Target AWS Account**: Ensure you have admin-level access to the target AWS account where you will be deploying the resources. This may involve assuming a specific IAM role *(ie: Shibboleth-InfraMgt/yourself@bu.edu, for the BU CSS account)*.

**Build Steps:**

1. Put your AWS profile in the environment:

   ```
   export AWS_PROFILE=[your profile]
   ```

2. Obtain [security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/security-creds.html?icmpid=docs_homepage_genref) for the admin-level [IAM role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html) you will be using for accessing the aws account to lookup and/or deploy resources.
   Create a [named profile](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html#cli-configure-files-using-profiles) out of these credentials in your [`~/.aws/credentials`](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html#cli-configure-files-where) file.

3. Clone the Repository:

      ```bash
      git clone https://github.com/your-repo/bu-lambda-shibboleth.git
      cd bu-lambda-shibboleth
      ```
   
4. Install all dependencies:
  
   ```
   npm install
   ```
   
5. *Bootstrapping* is the process of provisioning resources for the AWS CDK before you can deploy AWS CDK apps into an AWS [environment](https://docs.aws.amazon.com/cdk/v2/guide/environments.html). *(An AWS environment is a combination of an AWS account and Region).* You only need to bootstrap once for your chosen region within your account. The presence of a `"CDKToolKit"` cloud-formation stack for that region will indicate bootstrapping has already occurred. To bootstrap, follow [these steps](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html#bootstrapping-howto). The simple bootstrapping command is:

   ```
   export AWS_PROFILE=my_named_profile
   cdk bootstrap aws://[aws account ID]/us-east-1
   ```

6. If they do not already exist in AWS Secrets Manager, create the secrets that will be referenced by the lambda@edge functions. Typically, secrets should survive independent of the stack that uses them, so they are created here outside of the stack deployment process.

    1. Set the three secret values to complement the [Runtime Context](https://docs.aws.amazon.com/cdk/v2/guide/context.html) in a `./.env` file:
        
        - CLOUDFRONT_CHALLENGE_HEADER: In order to establish an ALB as an origin, it must be internet facing, and it must therefore be carefully locked down. In addition to only responding to https traffic, two additional measures are taken, where CLOUDFRONT_CHALLENGE_HEADER pertains to the second:
          1. The security group for the ALB must allow only ingress from Cloudfront IP address for the region of the distribution. A [Managed Prefix List](https://aws.amazon.com/blogs/networking-and-content-delivery/limit-access-to-your-origins-using-the-aws-managed-prefix-list-for-amazon-cloudfront/) for cloudfront is applied to the ALB security group as the only ingress rule.
          2. With ingress to the ALB restricted to the cloudfront service, now it must be further restricted to the specific SAML SP distribution. This distribution is configured to add a "secret" header value to each request it forwards to the ALB origin. The ALB is configured with a listener rule that allows through only requests that have this header and that its value matches the expected value. This approach is a standard AWS practice and is detailed here: [Restricting access to Application Load Balancers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)

        - SAML_PK: The private portion of the keypair used to authenticate with shibboleth. This can be in PEM format or just the raw key value. See `"SHIBBOTH.secret.samlCertSecretFld"` in [the context.json doc](./context/README.md) for background on this field.

        - SAML_CERT: The public certificate portion of the keypair used to authenticate with shibboleth. This must be in PEM format. See `"SHIBBOTH.secret.samlCertSecretFld"` in [the context.json doc](./context/README.md) for background on this field.
        
          ```
          LANDSCAPE="devl2"
          CLOUDFRONT_CHALLENGE="some_value"
          SAML_CERT="-----BEGIN CERTIFICATE-----
          MIIEGzCC... [truncated for brevity] ...
          -----END CERTIFICATE-----"
          SAML_PK="-----BEGIN PRIVATE KEY-----
          MIIEvQIB... [truncated for brevity] ...
          -----END PRIVATE KEY-----"
          ```

    2. Create the secrets in secrets manager. They will be referenced by the lambda@edge functions. 
        ```
        export AWS_PROFILE=[your profile]
        npm run create-secrets

        # NOTE: You can override the Landscape tag value by passing a landscape=arg argument:
        npm run create-secrets landscape=devl

        # Or you can control the secret name entirely by passing a secret_name=arg argument:
        npm run create-secrets secret_name=shibsp/wp/devl 
        ```

    3. Replace the placeholder value in `./context/context.json` for the `SHIBBOTH.secret.secretArn` field with the [ARN](https://docs.aws.amazon.com/managedservices/latest/userguide/find-arn.html) of the secret you just created.

    4. [OPTIONAL] If the secrets will be accessed from a different AWS account than the one they were created in, you must attach a resource-based policy to the secret to allow cross-account access. You can do this by running the following command:

        ```
        npm run attach-secret-policy accountId=TARGET_ACCOUNT_ID
        ```

        Replace `TARGET_ACCOUNT_ID` with the actual AWS account ID that needs access to the secret.

        This command modifies the resource policy of the secret to allow access from the specified account, provided that the secret is tagged with `CrossAccountAccess=true`.
    

7. Modify the `./context/context.json` file.
   This file will contain all parameters that the cdk will use when generating the Cloudformation template it later deploys. Most of these parameters correspond to something one might otherwise use as values being supplied to Cloudformation if it were being invoked directly, but they will appear "hard-coded" in the stack template. [From CDK docs on parameters](https://docs.aws.amazon.com/cdk/v2/guide/parameters.html):

   > *In general, we recommend against using AWS CloudFormation parameters with the AWS CDK. The usual ways to pass values into AWS CDK apps are [context values](https://docs.aws.amazon.com/cdk/v2/guide/context.html) and environment variables. Because they are not available at synthesis time, parameter values cannot be easily used for flow control and other purposes in your CDK app.*

   **[A Parameters Breakdown](./context/context.md)** is provided to help you understand what each parameter in the context.json file represents and how to set them appropriately for your deployment. 
   
   Alternatively, if you are deploying for Boston University, you can follow the **[BU Runbook](./docs/bu-runbook.md)**. It will focus you on a minor subset of parameters, and will steer you through a deployment specific to the Boston University environment and WordPress specifics only.


7. [OPTIONAL] Run the [CDK synth command](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli-synth) command to generate the cloudformation template that will be used to create the stack:

   ```
   mkdir ./cdk.out 2> /dev/null
   npm run synth
   ```

   *NOTE: The synth command will create a .json file, but will also output yaml to stdout. The command above redirects that output to a ./cdk.out/synth.output.yaml.*
   
8. Deploy the stack from scratch with the [CDK deploy command](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli-deploy):

   ```
   cdk deploy
   ```

   Alternatively, for preventing stack rollback on error and skipping prompts:

   ```
   npm run deploy
   ```

**Teardown:**

- To tear down the stack *(with no prompts)*:

  ```
  cdk destroy -f
  ```

  This command will result in an error if Lambda@Edge functions have been redeployed and thus have multiple versions.
  To avoid this error, the functions for these versions must be deleted.
  A cleanup script has been provided for this purpose:

  ```
  npm run cleanup
  ```

  to see what this script would delete without actually doing so, run:

  ```
  npm run cleanup dryrun
  ```

**Rebuild:**

- To cleanup, destroy the stack, and rebuild it in one non-prompted command:

  ```
  export AWS_PROFILE=bu && npm run cleanup && npm run redeploy
  ```

### Testing

To run all unit tests:

```
npm run test
```

Deeper dives into unit testing and logging:

- [Jest unit testing: Lambda@Edge event object mocking](./docs/testing-lambda-event-mocking.md)
- [Jest unit testing: ESM support](./docs/testing-esm-support.md)
- [Jest unit testing: Gotchas](./docs/testing-gotchas.md)
- [Where are the Lambda@Edge cloudwatch logs?](./docs/testing-lambda-at-edge-logs.md)


## Packaging/Installing
See [USAGE.md](./bin/build/USAGE.md) for packaging and usage instructions.

## References

- [Handling Redirects@Edge Part 1](https://aws.amazon.com/blogs/networking-and-content-delivery/handling-redirectsedge-part1/)

- [Securing and Accessing Secrets from Lambda@Edge using AWS Secrets Manager](https://aws.amazon.com/blogs/networking-and-content-delivery/securing-and-accessing-secrets-from-lambdaedge-using-aws-secrets-manager/)

- [Using Amazon CloudFront with AWS Lambda as origin to accelerate your web applications](https://aws.amazon.com/blogs/networking-and-content-delivery/using-amazon-cloudfront-with-aws-lambda-as-origin-to-accelerate-your-web-applications/)

  
