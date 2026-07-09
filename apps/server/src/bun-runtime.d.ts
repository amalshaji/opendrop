declare const Bun: {
  serve(options: { fetch: (request: Request) => Response | Promise<Response>; port: number }): unknown;
  file(path: string): Blob & { exists(): Promise<boolean> };
};
