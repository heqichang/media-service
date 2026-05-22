declare module 'node-media-server' {
  export default class NodeMediaServer {
    constructor(config: any);
    on(eventName: string, listener: (session: any) => void): void;
    run(): void;
    stop(): void;
  }
}
