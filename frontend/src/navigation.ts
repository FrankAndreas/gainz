// Leaving the page for the family hub (its login or logout), in one place so the tests can stand in for it
export function goTo(url: string): void {
  window.location.assign(url);
}
