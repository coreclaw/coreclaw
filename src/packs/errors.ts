export class PackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackValidationError";
  }
}

export class PackGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackGraphError";
  }
}
