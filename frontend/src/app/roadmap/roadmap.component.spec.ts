import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { renderResources } from '../students/domain-test-support';
import { RoadmapComponent } from './roadmap.component';
import type { RoadmapStage } from './roadmap-api.service';

describe('Roadmap editing contract', () => {
    const endpoint = '/api/v1/workspaces/w1/students/s1/roadmap';
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [RoadmapComponent],
            providers: [provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()],
        });
        http = TestBed.inject(HttpTestingController);
        TestBed.inject(SessionStore).load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({
            account: { userId: 'teacher', workspaceId: 'w1', role: 'TEACHER', authVersion: 1 },
            csrfToken: 'synthetic',
        });
    });
    afterEach(() => {
        http.verify();
        TestBed.resetTestingModule();
    });

    async function edit(stages: RoadmapStage[] = [], revision = 7) {
        const fixture = TestBed.createComponent(RoadmapComponent);
        fixture.componentRef.setInput('workspaceId', 'w1');
        fixture.componentRef.setInput('studentId', 's1');
        fixture.componentRef.setInput('editable', true);
        fixture.detectChanges();
        http.expectOne(endpoint).flush({ stages, revision });
        await renderResources();
        const element = fixture.nativeElement as HTMLElement;
        element.querySelector<HTMLButtonElement>('.edit-stages')!.click();
        fixture.detectChanges();
        return { fixture, element };
    }
    function button(element: HTMLElement, text: string) {
        const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.textContent?.trim() === text);
        expect(found, text).toBeTruthy();
        return found!;
    }
    function fill(input: HTMLInputElement, value: string) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
    }

    it('rejects a whitespace-only stage title with an accessible field error and no PUT', async () => {
        const { fixture, element } = await edit();
        button(element, 'Добавить этап').click();
        fixture.detectChanges();
        const title = element.querySelector<HTMLInputElement>('.stage-editor input')!;
        fill(title, '   ');
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        fixture.detectChanges();
        http.expectNone((request) => request.method === 'PUT');
        expect(title.getAttribute('aria-invalid')).toBe('true');
        expect(title.getAttribute('aria-describedby')).toBe('stage-title-error-0');
        expect(element.querySelector('#stage-title-error-0')?.textContent).toBe('Введите название этапа.');
        fill(title, 'Коллекции');
        fixture.detectChanges();
        expect(title.hasAttribute('aria-invalid')).toBe(false);
        expect(element.querySelector('#stage-title-error-0')).toBeNull();
        http.expectNone((request) => request.method === 'PUT');
    });

    it('saves trimmed fields with the loaded revision and shows the confirmed server result', async () => {
        const { fixture, element } = await edit([{ title: 'Старая тема', note: '', state: 'current' }], 7);
        const inputs = element.querySelectorAll<HTMLInputElement>('.stage-editor input');
        fill(inputs[0], '  Коллекции  ');
        fill(inputs[1], '  ноябрь  ');
        const form = element.querySelector('form')!;
        form.dispatchEvent(new Event('submit'));
        fixture.detectChanges();
        const save = http.expectOne(endpoint);
        expect(save.request.method).toBe('PUT');
        expect(save.request.body).toEqual({ revision: 7, stages: [{ title: 'Коллекции', note: 'ноябрь', state: 'current' }] });
        expect(button(element, 'Сохранить маршрут').disabled).toBe(true);
        form.dispatchEvent(new Event('submit'));
        http.expectNone((request) => request.method === 'PUT');
        save.flush({ revision: 8, stages: [{ title: 'Коллекции', note: 'ноябрь', state: 'current' }] });
        fixture.detectChanges();
        expect(element.querySelector('form')).toBeNull();
        expect(element.querySelector('.stages .title')?.textContent).toBe('Коллекции');
        expect(element.querySelector('.stages .state')?.textContent).toBe('сейчас, ноябрь');
        expect(button(element, 'Изменить этапы').disabled).toBe(false);
    });

    it('disables adding at thirty stages and enables it again after removing a stage', async () => {
        const stages: RoadmapStage[] = Array.from({ length: 29 }, (_, index) => ({ title: `Этап ${index + 1}`, note: '', state: 'ahead' }));
        const { fixture, element } = await edit(stages);
        button(element, 'Добавить этап').click();
        fixture.detectChanges();
        expect(element.querySelectorAll('.stage-editor li')).toHaveLength(30);
        expect(button(element, 'Добавить этап').disabled).toBe(true);
        button(element, 'Добавить этап').click();
        fixture.detectChanges();
        expect(element.querySelectorAll('.stage-editor li')).toHaveLength(30);
        element.querySelector<HTMLButtonElement>('[aria-label="Убрать этап 30"]')!.click();
        fixture.detectChanges();
        expect(element.querySelectorAll('.stage-editor li')).toHaveLength(29);
        expect(button(element, 'Добавить этап').disabled).toBe(false);
        http.expectNone((request) => request.method === 'PUT');
    });
});
