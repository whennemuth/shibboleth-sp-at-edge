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

### Build/Rebuild

**Prequisites :**

- AWS command line interface (CLI)
- Admin role in target aws account *(ie: `"Shibboleth-InfraMgt"`)*

**Build:**

1. Put your AWS profile in the environment:

   ```
   export AWS_PROFILE=[your profile]
   ```

2. Set the values for the [Runtime Context](https://docs.aws.amazon.com/cdk/v2/guide/context.html) by modifying the `./context/context.json` file accordingly.
   Most fields in `./context/context.json` are self-explanatory, but any additional explanation that might be needed can be found [here](./context/README.md).
   
2. Set the three secret values to complement the [Runtime Context](https://docs.aws.amazon.com/cdk/v2/guide/context.html) in a `./.env` file:
   
   - CLOUDFRONT_CHALLENGE_HEADER: In order to establish an ALB as an origin, it must be internet facing, and it must be carefully locked down. In addition to only responding to https traffic, two additional measures are taken, where CLOUDFRONT_CHALLENGE_HEADER pertains to the second:
     1. The security group for the ALB must allow only ingress from Cloudfront IP address for the region of the distribution. A [Managed Prefix List](https://aws.amazon.com/blogs/networking-and-content-delivery/limit-access-to-your-origins-using-the-aws-managed-prefix-list-for-amazon-cloudfront/) for cloudfront is applied to the ALB security group as the only ingress rule.
     2. With ingress to the ALB restricted to the cloudfront service, now it must be further restricted to the specific SAML SP distribution. This distribution is configured to add a "secret" header value to each request it forwards to the ALB origin. The ALB is configured with a listener rule that allows through only requests that have this header and that its value matches the expected value. This approach is a standard AWS practice and is detailed here: [Restricting access to Application Load Balancers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html)

   - SAML_PK: The private portion of the keypair used to authenticate with shibboleth. This can be in PEM format or just the raw key value. See `"SHIBBOTH.secret.samlCertSecretFld"` in [the context.json doc](./context/README.md) for background on this field. 
   
   ```
   CLOUDFRONT_CHALLENGE="some_value"
   SAML_PK="MIIG/gIBADANBgk...."
   ```
   
4. Deploy the stack from scratch

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



## References

- [Handling Redirects@Edge Part 1](https://aws.amazon.com/blogs/networking-and-content-delivery/handling-redirectsedge-part1/)

- [Securing and Accessing Secrets from Lambda@Edge using AWS Secrets Manager](https://aws.amazon.com/blogs/networking-and-content-delivery/securing-and-accessing-secrets-from-lambdaedge-using-aws-secrets-manager/)

- [Using Amazon CloudFront with AWS Lambda as origin to accelerate your web applications](https://aws.amazon.com/blogs/networking-and-content-delivery/using-amazon-cloudfront-with-aws-lambda-as-origin-to-accelerate-your-web-applications/)

  
