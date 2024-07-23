## Gotchas

Use of the [aws-sdk-client-mock](https://aws.amazon.com/blogs/developer/mocking-modular-aws-sdk-for-javascript-v3-in-unit-tests/) mocking library will typically fail if your modules/functions under test are in a subdirectory for a nodejs code that is part of a lambda function, and therefore has its own node_modules directory within:

```
root
|__ lib
    |__ lambda-root
        |__ file_under_test.mjs (has import { something } from '@aws-sdk/client-dynamodb')
        |__ node_modules
            |__ @aws-sdk
                |__ client-dynamodb
    test
    |__ file_under_test.test.mjs (has import { something } from '@aws-sdk/client-dynamodb')
    |__ node_modules
        |__ @aws-sdk
            |__ client-dynamodb
```

Here you can see there are two dynamodb target libraries. The mocking library fails to mock the aws dynamodb module because it targets the wrong one *(probably `root/test/node_modules/@aws-sdk/client-dynamodb`)*
To avoid this, the tests need to be in the same nodejs root as the files under test:

```
root
|__ lib
    |__ lambda-root
        |__ file_under_test.mjs
        |__ test
            |__ file_under_test.test.mjs
        |__ node_modules
            |__ @aws-sdk
                |__ client-dynamodb

```

