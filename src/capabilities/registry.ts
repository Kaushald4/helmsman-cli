import type { Capability } from "./types.js";

export class CapabilityRegistry {
  private capabilities = new Map<string, Capability>();

  /**
   * Registers a capability into the central registry.
   */
  register(capability: Capability): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Capability with id '${capability.id}' is already registered.`);
    }
    this.capabilities.set(capability.id, capability);
  }

  /**
   * Registers multiple capabilities at once.
   */
  registerAll(capabilities: Capability[]): void {
    for (const cap of capabilities) {
      this.register(cap);
    }
  }

  /**
   * Retrieves a capability by exact id.
   */
  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  /**
   * Returns all registered capabilities.
   */
  list(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Returns all capabilities under a specific namespace (e.g. 'reddit' for 'reddit.feed').
   */
  listByNamespace(namespace: string): Capability[] {
    const prefix = `${namespace}.`;
    return this.list().filter((cap) => cap.id.startsWith(prefix));
  }
}

/** Global default registry instance */
export const defaultRegistry = new CapabilityRegistry();
