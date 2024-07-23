## Jest ESM support

In order to allow jest to test against [ECMAScript Modules](https://nodejs.org/api/esm.html#modules-ecmascript-modules), it is necessary to activate its experimental support for ESM.
The following [jest documentation](https://jestjs.io/docs/ecmascript-modules) was followed in order to do this, but a few things are worth pointing out that were encountered while getting this to work:

- Do NOT explicitly mark the nodejs project as using modules by putting `"type": "module"` into the package.json file.

- One could activate the ESM support by exporting the necessary environment variable:

  ```
  export NODE_OPTIONS=--experimental-vm-modules
  ```

  However, to achieve the same effect automatically, use the [cross-env](https://www.npmjs.com/package/cross-env) package to allow setting the environment variable automatically as part of the script execution. Note the cross-env usage in the following package.json excerpt:

  ```
    "scripts": {
      "build": "tsc",
      "watch": "tsc -w",
      "test": "cross-env NODE_OPTIONS=--experimental-vm-modules jest",
      "cdk": "cdk"
    },
  ```

- Lastly, you can activate ESM directly from a launch configuration. This example also targets a specific test file:

  ```
  {
        "type": "node",
        "request": "launch",
        "name": "Jest SP",
        "program": "${workspaceFolder}/node_modules/jest/bin/jest.js",
        "args": [ 
          "--runTestsByPath", 
          "--silent",
          "-i", 
          "${workspaceFolder}/lib/lambda/FunctionSpOrigin.test.ts" 
        ],
        "runtimeArgs": [ "--experimental-vm-modules" ],
        "console": "integratedTerminal",
        "internalConsoleOptions": "neverOpen",
        "env": {
          "unmocked": "false",
          "AWS_PROFILE": "bu",
          "AWS_REGION": "us-east-2"
        }
  }
  ```

  With this launch configuration, you can place a breakpoint inside your tests, or the file under test and step through the code.
  *NOTE: If on windows, the `--runTestsByPath` jest argument is necessary*