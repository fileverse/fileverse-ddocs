// Entry point for `@fileverse-dev/ddoc/swarm`: optional storage on Ethereum
// Swarm, for images (the `imageUploadFn` / `imageFetchFn` props) and for
// documents with version history. Keep this free of React and editor
// imports, so it also runs where no editor is loaded.
export {
  createSwarmImageUploadFn,
  createSwarmImageFetchFn,
} from './package/utils/swarm-storage';
export type { SwarmStorageConfig } from './package/utils/swarm-storage';
export {
  createSwarmDocumentStorage,
  canSaveToSwarm,
  generateDocumentKey,
  makeDocumentFeedTopic,
} from './package/utils/swarm-document-storage';
export type {
  SwarmDocumentStorage,
  SwarmDocumentStorageConfig,
  DocumentSnapshot,
  DocumentVersion,
} from './package/utils/swarm-document-storage';
export { SwarmTimeoutError } from './package/utils/swarm-common';
export type {
  SwarmProgress,
  SwarmProgressHandler,
  SwarmRequestConfig,
} from './package/utils/swarm-common';
export {
  detectSwarmTransport,
  createBeeHttpTransport,
  createSwarmProviderTransport,
  probeLatestFeedIndex,
} from './package/utils/swarm-transport';
export type {
  SwarmTransport,
  SwarmTransportStatus,
  SwarmProvider,
  BeeHttpTransportConfig,
  TransportDetectionConfig,
} from './package/utils/swarm-transport';
export {
  diagnoseSwarm,
  primarySwarmCondition,
} from './package/utils/swarm-diagnostics';
export type {
  SwarmCondition,
  SwarmConditionKind,
  SwarmDiagnosticsInput,
  SwarmRemedy,
  SwarmRemedyKind,
} from './package/utils/swarm-diagnostics';
export {
  makeFeedTopic,
  writeFeedUpdate,
  readLatestFeedIndex,
  readFeedUpdate,
  feedOwnerAddress,
} from './package/utils/swarm-feeds';
export type { SwarmFeedConfig } from './package/utils/swarm-feeds';
export {
  listStamps,
  getStamp,
  stampUtilization,
  checkStampHealth,
  buyStamp,
  topUpStamp,
  diluteStamp,
  getChainState,
  getWalletBalance,
  estimateBatch,
  amountForDuration,
  MIN_BATCH_DEPTH,
  CHUNK_SIZE_BYTES,
  PLUR_PER_BZZ,
  BLOCK_TIME_SECONDS,
} from './package/utils/swarm-stamps';
export type {
  SwarmNodeConfig,
  PostageStamp,
  StampHealth,
  StampHealthThresholds,
  ChainState,
  WalletBalance,
  BatchEstimate,
} from './package/utils/swarm-stamps';
