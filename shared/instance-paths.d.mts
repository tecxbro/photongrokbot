export type InstancePaths = { root:string; configPath:string; secretsDir:string; bridgeEnv:string; liveMiniEnv:string; dataDir:string; databasePath:string; inboundAttachmentsDir:string; outboundAssetsDir:string; viewsDir:string; modelsDir:string; toolsDir:string; liveMiniContextDir:string; backupsDir:string; logsDir:string };
export type InstanceOptions = { env?: Record<string,string|undefined>; instanceDir?:string; checkoutRoot?:string; testMode?:boolean };
export function resolveInstancePaths(options?:InstanceOptions):InstancePaths;
export function ensureInstancePaths(paths:InstancePaths):void;
export function assertPrivateFile(path:string,allowedRoot:string):string;
export function atomicPrivateWrite(path:string,content:string|Uint8Array):void;
