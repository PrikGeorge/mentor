import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { StudentsPageComponent } from './students-page.component';
import type { StudentView } from './students-api.service';
import { renderResources, student } from './domain-test-support';

const root = '/api/v1/workspaces/w1/students';
const turns = '/api/v1/workspaces/w1/homework/turns?page=0&size=100';

describe('Teacher student list', () => {
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [StudentsPageComponent],
            providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()],
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

    function mount() {
        const fixture = TestBed.createComponent(StudentsPageComponent);
        fixture.detectChanges();
        return { fixture, element: fixture.nativeElement as HTMLElement };
    }

    function button(element: HTMLElement, text: string) {
        const found = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent?.trim() === text);
        expect(found, text).toBeTruthy();
        return found!;
    }

    async function resolveCards(request: TestRequest, cards: StudentView[], total = cards.length, page = 0) {
        request.flush({ items: cards.map((value) => ({ student: value, lessonCount: 0, focus: null })), page, size: 25, total });
        await renderResources();
        if (cards.length) {
            http.expectOne(turns).flush({ items: [], page: 0, size: 100, total: 0 });
            await renderResources();
        } else http.expectNone(turns);
    }

    it('opens the archive from a later page and returns to the first active page', async () => {
        const { fixture, element } = mount();
        await resolveCards(http.expectOne(root + '/dashboards?page=0&size=25'), [student], 26);
        button(element, 'Далее').click();
        fixture.detectChanges();
        const second = { ...student, id: 's2', name: 'Ученик второй страницы' };
        await resolveCards(http.expectOne(root + '/dashboards?page=1&size=25'), [second], 26, 1);
        expect(element.querySelector('nav[aria-label="Страницы учеников"]')?.textContent).toContain('Страница 2 из 2');

        button(element, 'Архив').click();
        fixture.detectChanges();
        expect(element.textContent).not.toContain(second.name);
        const archived = { ...student, id: 'archived', name: 'Завершивший обучение' };
        await resolveCards(http.expectOne(root + '/dashboards?page=0&size=25&archived=true'), [archived]);
        expect(element.querySelector('h1')?.textContent).toBe('Архив учеников');
        expect(element.querySelector('a.student-card')?.getAttribute('href')).toBe('/teacher/students/archived');
        expect(element.querySelector('a.student-card')?.textContent).toContain(archived.name);

        button(element, 'К активным ученикам').click();
        fixture.detectChanges();
        await resolveCards(http.expectOne(root + '/dashboards?page=0&size=25'), [student]);
        expect(element.querySelector('h1')?.textContent).toBe('Мои ученики');
        expect(element.textContent).not.toContain(archived.name);
        expect(element.querySelector('a.student-card')?.textContent).toContain(student.name);
    });

    it('retries a failed list and keeps recovered cards visible if the optional turn read fails', async () => {
        const { fixture, element } = mount();
        http.expectOne(root + '/dashboards?page=0&size=25').flush({ message: 'Список временно недоступен' }, { status: 503, statusText: 'Unavailable' });
        await renderResources();
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('Список временно недоступен');
        expect(element.querySelector('[role="status"]')).toBeNull();

        button(element, 'Повторить загрузку').click();
        fixture.detectChanges();
        expect(element.querySelector('[role="alert"]')).toBeNull();
        http.expectOne(root + '/dashboards?page=0&size=25').flush({
            items: [{ student, lessonCount: 0, focus: null }],
            page: 0,
            size: 25,
            total: 1,
        });
        await renderResources();
        expect(element.querySelector('a.student-card')?.textContent).toContain(student.name);
        http.expectOne(turns).flush({}, { status: 503, statusText: 'Unavailable' });
        await renderResources();
        expect(element.querySelector('a.student-card')?.textContent).toContain(student.name);
        expect(element.querySelector('[role="alert"]')).toBeNull();
        expect(element.querySelector('[role="status"]')).toBeNull();
        expect(element.querySelector('.queue')).toBeNull();
    });

    it('shows the empty list only after loading and connects creation, cancellation and navigation', async () => {
        const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
        const { fixture, element } = mount();
        expect(element.querySelector('[role="status"]')?.textContent).toContain('Загружаем учеников');
        expect(element.querySelector('.empty-state')).toBeNull();
        await resolveCards(http.expectOne(root + '/dashboards?page=0&size=25'), []);
        expect(element.querySelector('.empty-state')?.textContent).toContain('Учеников пока нет');
        expect(element.querySelector('[role="status"]')).toBeNull();

        button(element, 'Добавить ученика').click();
        fixture.detectChanges();
        expect(element.querySelector('mentor-student-form')).toBeTruthy();
        button(element, 'Отмена').click();
        fixture.detectChanges();
        expect(element.querySelector('mentor-student-form')).toBeNull();
        http.expectNone((request) => request.method === 'POST');

        button(element, 'Добавить ученика').click();
        fixture.detectChanges();
        const name = element.querySelector<HTMLInputElement>('[name="name"]')!;
        name.value = 'Новая ученица';
        name.dispatchEvent(new Event('input'));
        element.querySelector('form')!.dispatchEvent(new Event('submit'));
        const creation = http.expectOne(root);
        expect(creation.request.method).toBe('POST');
        creation.flush({ ...student, id: 'new-student', name: 'Новая ученица' });
        await renderResources();
        expect(element.querySelector('mentor-student-form')).toBeNull();
        expect(navigate).toHaveBeenCalledWith(['/teacher/students', 'new-student']);
    });
});
