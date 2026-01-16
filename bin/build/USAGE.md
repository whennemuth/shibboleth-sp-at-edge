# Shibboleth SP at Edge - Usage Guide

This package provides a reusable AWS CDK construct for implementing Shibboleth Service Provider (SP) authentication at the edge using CloudFront and Lambda@Edge.

## Packaging

Run the following to create a tarball package of the construct. This tarball can then be uploaded to a private NPM repository or shared directly. You will find the generated `.tgz` file in the project root after running the command.

```bash
npm run pack
```

## Installation

```bash
npm install shibboleth-sp-at-edge
```

## Usage

### Option 1: Add to an Existing Stack

Use `getInstance()` to add the Shibboleth construct to an existing CDK stack:

```typescript
import { App, Stack } from 'aws-cdk-lib';
import { ShibbolethAtEdgeConstruct, IContext } from 'shibboleth-sp-at-edge';

const app = new App();
const stack = new Stack(app, 'MyExistingStack');

// Your context configuration
const context: IContext = {
  // ... your configuration
};

// Add Shibboleth authentication to your existing stack
const shibbolethAuth = ShibbolethAtEdgeConstruct.getInstance(
  stack, 
  'ShibbolethAuth', 
  context
);

// Access the CloudFront distribution
console.log('Distribution ID:', shibbolethAuth.distribution.distributionId);
```

### Option 2: Create a Dedicated Stack

Use `createStack()` to create a standalone stack for Shibboleth authentication:

```typescript
import { App } from 'aws-cdk-lib';
import { ShibbolethAtEdgeConstruct, IContext } from 'shibboleth-sp-at-edge';

const app = new App();

// Your context configuration
const context: IContext = {
  // ... your configuration
};

// Create a dedicated stack for Shibboleth authentication
const shibbolethStack = ShibbolethAtEdgeConstruct.createStack(app, context);
```

## Configuration

The construct requires an `IContext` configuration object. Here's a minimal example:

```typescript
import { IContext, CloudFrontCachingStrategy, OriginType } from 'shibboleth-sp-at-edge';

const context: IContext = {
  STACK_ID: 'my-shibboleth-stack',
  ACCOUNT: '123456789012',
  REGION: 'us-east-1',
  APP_LOGIN_HEADER: 'SHIB-HANDLER',
  APP_LOGOUT_HEADER: 'SHIB-IDP-LOGOUT',
  CLOUDFRONT_CACHING_STRATEGY: CloudFrontCachingStrategy.BU_CACHE,
  ORIGIN: {
    originType: OriginType.ALB,
    stackId: 'my-origin-stack',
    dnsName: 'my-alb.us-east-1.elb.amazonaws.com',
    httpsPort: 443,
    appAuthorization: true
  },
  DNS: {
    hostedZone: 'example.edu',
    certificateARN: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012'
  },
  SHIBBOLETH: {
    entityId: 'https://myapp.example.edu/shibboleth',
    idpCert: 'MIIDPDCCAiSgAwIBAgIV...', // Base64 encoded IdP certificate
    entryPoint: 'https://idp.example.edu/idp/profile/SAML2/Redirect/SSO',
    logoutUrl: 'https://idp.example.edu/idp/logout.jsp',
    secret: {
      secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:shibboleth/config-AbCdEf',
      refreshInterval: '3600000',
      samlPrivateKeySecretFld: 'sp-private-key',
      samlCertSecretFld: 'sp-certificate',
      jwtPrivateKeySecretFld: 'jwt-private-key',
      jwtPublicKeySecretFld: 'jwt-public-key'
    }
  },
  TAGS: {
    Service: 'MyApp',
    Function: 'Authentication',
    Landscape: 'prod'
  }
};
```

## Key Features

- **Shibboleth SP Authentication**: Full SAML2 Service Provider implementation
- **Lambda@Edge Integration**: Authentication logic runs at CloudFront edge locations
- **Flexible Origins**: Support for ALB, Function URLs, and other origin types
- **Route53 Integration**: Automatic DNS management
- **Secrets Management**: Secure handling of SP certificates and keys
- **Dual Module Support**: Works with both CommonJS and ESM projects

## API Reference

### ShibbolethAtEdgeConstruct

#### Static Methods

- `getInstance(scope, id, context)`: Add to existing stack
- `createStack(scope, context)`: Create dedicated stack

#### Properties

- `distribution`: The CloudFront distribution
- `lambdaOriginRequest`: The origin request Lambda@Edge function
- `lambdaViewerRequest`: The viewer request Lambda@Edge function
- `lambdaViewerResponse`: The viewer response Lambda@Edge function

## Requirements

- AWS CDK v2.223.0 or later
- Node.js 16 or later
- Valid Shibboleth IdP configuration

## Support

For issues and questions, please refer to the project documentation or create an issue in the source repository.