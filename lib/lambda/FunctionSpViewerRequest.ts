
export const VIEWER_DOMAIN_HEADER_NAME = 'VIEWER_DOMAIN';

export const handler  = async (event:any) => {
  try {
    console.log(JSON.stringify(event, null, 2));

    const { request, request: { headers = {} } = {} } = event.Records[0].cf;
    const viewerDomain = headers['host']?.[0]?.value;

    /**
     * If the request is bound for a function URL, then the origin request policy will be
     * ALL_VIEWER_EXCEPT_HOST_HEADER, which means that the Host header of the viewer is not passed
     * to the origin and the origin host is substituted instead. However, the origin request function
     * needs to know the viewer domain in order to build proper redirects to the IDP, so we
     * pass it along here in a custom header.
     */
    request.headers[VIEWER_DOMAIN_HEADER_NAME.toLowerCase()] = [ 
      { key: VIEWER_DOMAIN_HEADER_NAME, value: viewerDomain } 
    ];

    return request;
  } 
  catch (error:any) {
    return {
      status: 501,
      body: `Viewer request lambda error: ${error.message}`
    }
  }

};