export class BindingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingValidationError";
  }
}

export class BindingResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingResolutionError";
  }
}
