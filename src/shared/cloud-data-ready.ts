/** Failed or incomplete cloud reads must keep the account loading screen open. */
export function cloudDataReady(results: PromiseSettledResult<unknown>[], required: number[]): boolean {
  return required.length > 0 && required.every((index) => {
    const result = results[index];
    return result?.status === 'fulfilled' && result.value === true;
  });
}
