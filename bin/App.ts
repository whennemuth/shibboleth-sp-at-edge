#!/usr/bin/env node
import { App, Stack } from 'aws-cdk-lib';
import 'source-map-support/register';
import { IContext } from '../context/IContext';
import * as ctx from '../context/context.json';
import { ShibbolethAtEdgeConstruct } from '../lib/ShibbolethAtEdgeConstruct';

// Instantiate the app
const app = new App();

// Cast the context to the IContext type
const context = ctx as IContext;

// Create the Shibboleth infrastructure using the reusable construct
(async () => {
  const stack = await ShibbolethAtEdgeConstruct.createStack(app, context);
})();

