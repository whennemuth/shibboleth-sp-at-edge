import { IContext } from "../context/IContext";

const isBlank = (s:string|null|undefined):boolean => {
  return s === undefined || s === null || `${s}`.trim() == '';
}
const isNotBlank = (s:string|null|undefined) => !isBlank(s);
const anyBlank = (...a:any) => a.findIndex((s:any) =>  isBlank(s)) > -1;
const anyNotBlank = (...a:any) => a.findIndex((s:any) => isNotBlank(s)) > -1;
const allBlank = (...a:any) => !anyNotBlank(...a);
const noneBlank = (...a:any) => !anyBlank(...a);
const someBlankSomeNot = (...a:any) => anyBlank(...a) && anyNotBlank(...a);

export const ParameterTester = {
  isBlank, isNotBlank, anyBlank, anyNotBlank, allBlank, noneBlank, someBlankSomeNot
}

export const instanceOf = <T>(value: any, fieldName: string): value is T => fieldName in value;

export const getClone = <T>(obj:T):T => {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * @returns The name of the stack
 */
export const getStackName = (context:IContext):string => {
  const { STACK_ID, TAGS: { Landscape } } = context;
  return `${STACK_ID}-${Landscape}`;
}

export const echoStackName = () => {
  const contextModule = require('../context/context.json') as IContext;
  const stackName = getStackName(contextModule);
  console.log(stackName);
}

export const logHeader = (header:string) => {
  const spacer = ' '.repeat((80 - header.length) / 2);
  console.log('\n' + '='.repeat(80));
  console.log(`${spacer}${header}`);
  console.log('='.repeat(80));
}
