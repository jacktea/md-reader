// Minimal typed surface for the mermaid v9 API used by md-reader.
// mermaid@9 does not ship its own type declarations.

declare module 'mermaid' {
  export interface MermaidConfig {
    startOnLoad?: boolean
    theme?: string
    themeVariables?: Record<string, unknown>
    [key: string]: unknown
  }

  const mermaid: {
    initialize(config: MermaidConfig): void
    mermaidAPI: {
      render(
        id: string,
        text: string,
        cb?: (svg: string, bindFunctions?: (el: Element) => void) => void,
        container?: Element,
      ): Promise<string>
    }
  }

  export default mermaid
}
