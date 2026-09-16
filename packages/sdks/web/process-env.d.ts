/**
 * `process.env.<X>` in this SDK is not a Node global: tsup replaces it with a
 * literal at build time, and the bundle runs in a browser / React Native, where
 * no `process` exists. Declaring only what is read keeps that honest, where
 * `"types": ["node"]` would tell the compiler this package runs on Node and
 * would hand it every Node global.
 */
declare const process: {
  env: Record<string, string | undefined>;
};
