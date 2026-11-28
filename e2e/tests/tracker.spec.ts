import { expect, test } from '@playwright/test';
import { login } from './helpers';

// The tracker's behaviour before its styling moves to Tailwind (themes 2026-11-28): this must keep working after it
test('log a workout and see it on the day', async ({ page, request }) => {
    const errors = await login(page, request);
    await page.getByLabel('Exercise:').selectOption({ label: 'Squats' });
    await page.getByLabel('Reps:').fill('12');
    await page.getByLabel('Weight (optional):').fill('20');
    await page.getByRole('button', { name: 'Add Set' }).click();
    // The sets to log come first on the page (the day below may list the same set from an earlier test)
    const toLog = page.getByRole('heading', { name: 'Sets to log:' });
    await expect(toLog).toBeVisible();
    await expect(page.getByText('Set 1: 12 reps @ 20 kg').first()).toBeVisible();
    // Remove and undo
    await page.getByRole('button', { name: 'Remove set' }).click();
    await expect(page.getByText('Set removed.')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'Remove set' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Log Workout' }).click();
    await expect(toLog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Week summary' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Personal records' })).toBeVisible();
    // The day's list shows the set
    await expect(page.getByText(/^Set 1: 12 reps @ 20 kg$/).last()).toBeVisible();
    expect(errors).toEqual([]);
});

test('week navigation: back a week, and not past this week', async ({ page, request }) => {
    await login(page, request);
    const next = page.getByRole('button', { name: 'Next week' });
    await expect(next).toBeDisabled();
    const label = await page.getByText(/^Week of /).textContent();
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(page.getByText(/^Week of /)).not.toHaveText(label!);
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.getByText(/^Week of /)).toHaveText(label!);
    // A day of the week can be picked: pressed, the others not
    const days = page.getByRole('button', { pressed: true });
    await expect(days).toHaveCount(1);
});

test('the log button waits for a set, and an error is shown', async ({ page, request }) => {
    await login(page, request);
    await expect(page.getByRole('button', { name: 'Log Workout' })).toBeDisabled();
    await page.route('**/api/workouts', route => route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.continue());
    await page.getByLabel('Exercise:').selectOption({ label: 'Push-ups' });
    await page.getByLabel('Reps:').fill('5');
    await page.getByRole('button', { name: 'Add Set' }).click();
    await page.getByRole('button', { name: 'Log Workout' }).click();
    await expect(page.getByText(/fail|error|could not/i).first()).toBeVisible();
});
