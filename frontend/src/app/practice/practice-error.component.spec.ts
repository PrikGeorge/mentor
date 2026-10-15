import { TestBed } from '@angular/core/testing';
import { PracticeErrorComponent } from './practice-error.component';
describe('Practice error block', () => {
    afterEach(() => TestBed.resetTestingModule());
    function setup(canRetry = true, label?: string) {
        TestBed.configureTestingModule({ imports: [PracticeErrorComponent] });
        const fixture = TestBed.createComponent(PracticeErrorComponent);
        fixture.componentRef.setInput('message', 'Ответ не получен.');
        fixture.componentRef.setInput('canRetry', canRetry);
        if (label) fixture.componentRef.setInput('retryLabel', label);
        fixture.detectChanges();
        return { fixture, element: fixture.nativeElement as HTMLElement };
    }
    it('announces the message as one alert and repeats the failed step on request', () => {
        const { fixture, element } = setup();
        const alert = element.querySelector('[role=alert]')!;
        expect(alert.textContent).toContain('Ответ не получен.');
        let retries = 0;
        fixture.componentInstance.retry.subscribe(() => retries++);
        const button = element.querySelector('button')!;
        expect(button.textContent?.trim()).toBe('Повторить');
        button.click();
        expect(retries).toBe(1);
    });
    it('shows a custom retry label and hides the button when nothing can be repeated', () => {
        const labelled = setup(true, 'Повторить проверку сессии');
        expect(labelled.element.querySelector('button')?.textContent?.trim()).toBe('Повторить проверку сессии');
        labelled.fixture.destroy();
        TestBed.resetTestingModule();
        const silent = setup(false);
        expect(silent.element.querySelector('button')).toBeNull();
        expect(silent.element.querySelector('[role=alert]')?.textContent).toContain('Ответ не получен.');
    });
});
