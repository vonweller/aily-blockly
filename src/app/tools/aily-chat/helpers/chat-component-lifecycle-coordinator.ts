export class ChatComponentLifecycleCoordinator {
  constructor(
    private readonly deps: {
      isHostInitialized: () => boolean;
      initializeHost: () => void;
      loadMermaid: () => Promise<{ default?: any } | any>;
      setMermaidInstance: (instance: any) => void;
      exposeEditBlockTools: () => void;
      initializeEngine: () => void;
      destroyEngine: () => void;
    },
  ) {}

  initialize(): void {
    if (!this.deps.isHostInitialized()) {
      this.deps.initializeHost();
    }

    void this.deps.loadMermaid().then((mermaidModule) => {
      this.deps.setMermaidInstance(mermaidModule?.default ?? mermaidModule);
    });

    this.deps.exposeEditBlockTools();
    this.deps.initializeEngine();
  }

  destroy(): void {
    this.deps.destroyEngine();
  }
}