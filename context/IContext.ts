export interface IContext {
    STACK_ID:                           string;
    ACCOUNT:                            string;
    REGION:                             string;
    DNS?:                               DNS;
    ORIGIN?:                            Origin;
    APP_LOGIN_HEADER:                   string;
    APP_LOGOUT_HEADER:                  string;
    CLOUDFRONT_CACHING_STRATEGY?:       CloudFrontCachingStrategy;
    SHIBBOLETH:                         Shibboleth;
    TAGS:                               Tags;
}

export enum CloudFrontCachingStrategy {
    NO_CACHE = 'no-cache',
    STANDARD = 'standard',
    BU_CACHE = 'bu-cache'
};

export enum OriginType {
    ALB = 'alb', FUNCTION_URL = 'function-url'
};
export type Origin = {
    originType:          OriginType;
    stackId?:            string;
    httpPort?:           number;
    httpsPort:           number;
    subdomain?:          string; // Includes hostedZone AND subdomain
    appAuthorization:    boolean;
};

export type DNS = {
    hostedZone:         string;
    certificateARN:     string;
}

export interface OriginFunctionUrl extends Origin {
    originType: OriginType.FUNCTION_URL;
    url?:       String
};
export interface OriginAlb extends Origin {
    originType: OriginType.ALB;
    dnsName:    string;
};

export interface Shibboleth {
    entityId:   string;
    idpCert:    string;
    entryPoint: string;
    logoutUrl:  string;
    secret:     Secret;
}

export interface SecretFieldNames {
    samlPrivateKeySecretFld:      string;
    samlCertSecretFld:            string;
    jwtPrivateKeySecretFld:       string;
    jwtPublicKeySecretFld:        string;
}

export interface Secret extends SecretFieldNames {
    secretArn:                   string;
    refreshInterval:             string;
}

export interface Tags {
    Service:   string;
    Function:  string;
    Landscape: string;
    CostCenter?: string;
    Ticket?: string;
}
