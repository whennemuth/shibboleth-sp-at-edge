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
