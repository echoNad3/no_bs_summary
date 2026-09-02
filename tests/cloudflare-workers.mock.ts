/** Minimal Node test stand-in for the Worker runtime base class. */
export abstract class DurableObject<Env> {
  protected constructor(
    protected readonly ctx: DurableObjectState,
    protected readonly env: Env,
  ) {}

  abstract fetch(request: Request): Promise<Response>;
}
