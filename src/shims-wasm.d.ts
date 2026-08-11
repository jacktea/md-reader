declare module '*.wasm' {
  /** URL of the emitted wasm asset (webpack asset/resource). */
  const url: string
  export default url
}
