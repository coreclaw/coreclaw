export class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(value: T) => void> = [];

  push(item: T) {
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(item);
      return;
    }
    this.items.push(item);
  }

  async next(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      return item;
    }
    return new Promise<T>((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}
