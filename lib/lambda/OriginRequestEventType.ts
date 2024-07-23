export interface CloudFrontHeaders {
  [name: string]: Array<{
    key: string;
    value: string;
  }>;
}

export interface CloudFrontOrigin {
  custom: {
    customHeaders: CloudFrontHeaders;
    domainName: string;
    keepaliveTimeout: number;
    path: string;
    port: number;
    protocol: string;
    readTimeout: number;
    sslProtocols: string[];
    //(Amazon S3 origins only):
    authMethod?: string;
    region?: string;
  };
}

export interface CloudFrontRequestBody {
  inputTruncated: boolean,
  action: string,
  encoding: string,
  data: string
}

export interface CloudFrontRequest {
  clientIp: string;
  headers: CloudFrontHeaders;
  method: string;
  origin: CloudFrontOrigin;
  querystring: string;
  uri: string;
  body?: CloudFrontRequestBody;
}

export interface CloudFrontConfig {
  distributionDomainName: string;
  distributionId: string;
  eventType: string;
  requestId: string;
}

export interface CloudFrontEvent {
  config: CloudFrontConfig;
  request: CloudFrontRequest;
}

export interface LambdaEdgeOriginRequestEvent {
  Records: Array<{
    cf: CloudFrontEvent;
  }>;
}