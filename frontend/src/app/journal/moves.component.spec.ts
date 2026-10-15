import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import { renderResources } from '../students/domain-test-support';
import { Move, MovesComponent } from './moves.component';

describe('Public journal links and page limit', () => {
    const endpoint = '/api/v1/workspaces/w1/students/s1/moves';
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [MovesComponent],
            providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()],
        });
        http = TestBed.inject(HttpTestingController);
    });
    afterEach(() => {
        http.verify();
        TestBed.resetTestingModule();
    });

    function mount(role: 'STUDENT' | 'TEACHER', preview = false, size = 10) {
        TestBed.inject(SessionStore).load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({
            account: { userId: 'synthetic-' + role, workspaceId: 'w1', role, authVersion: 1 },
            csrfToken: 'synthetic',
        });
        const fixture = TestBed.createComponent(MovesComponent);
        const base = role === 'TEACHER' ? '/teacher/students/s1' : '/learn/students/s1';
        for (const [key, value] of Object.entries({ workspaceId: 'w1', studentId: 's1', base, name: 'Анна', learner: role === 'STUDENT', preview, size })) {
            fixture.componentRef.setInput(key, value);
        }
        fixture.detectChanges();
        return { fixture, element: fixture.nativeElement as HTMLElement, base };
    }
    function move(index: number, patch: Partial<Move> = {}): Move {
        return { kind: 'homework', side: 'student', at: '2026-10-15T10:00:00Z', lessonId: 'l1', lessonTitle: 'Коллекции', refId: `work-${index}`, ...patch };
    }

    for (const role of ['STUDENT', 'TEACHER'] as const) {
        it(`uses learner wording and public lesson links for ${role === 'STUDENT' ? 'a student' : 'teacher preview'}`, async () => {
            const preview = role === 'TEACHER';
            const { element, base } = mount(role, preview);
            const request = http.expectOne((request) => request.url === endpoint);
            expect(request.request.params.get('audience')).toBe(preview ? 'student' : null);
            request.flush({
                items: [
                    move(1),
                    move(2, { kind: 'review', side: 'teacher', status: 'reviewed' }),
                    move(3, { kind: 'attempt', status: 'accepted' }),
                    move(4, { kind: 'conducted', side: 'teacher' }),
                ],
                page: 0,
                size: 10,
                total: 4,
            });
            await renderResources();
            expect(Array.from(element.querySelectorAll('.what > p > b'), (item) => item.textContent)).toEqual(['Ты', 'Наставник', 'Ты', 'Наставник']);
            expect(Array.from(element.querySelectorAll('.moves a'), (item) => item.getAttribute('href'))).toEqual(
                ['homework', 'review', 'practice', 'tasks'].map((section) => `${base}/lessons/l1/student/${section}${preview ? '?preview=student' : ''}`)
            );
            expect(element.querySelector('.count')?.textContent).toBe('всего 4');
        });
    }

    it('caps expanded requests at one hundred and removes the more button while preserving the total', async () => {
        const { fixture, element } = mount('STUDENT', false, 90);
        http.expectOne(endpoint + '?page=0&size=90').flush({ items: Array.from({ length: 90 }, (_, index) => move(index)), page: 0, size: 90, total: 140 });
        await renderResources();
        expect(element.querySelector('.count')?.textContent).toBe('последние 90 из 140');
        const more = element.querySelector<HTMLButtonElement>('.moves-block > button')!;
        expect(more.textContent?.trim()).toBe('Показать ещё');
        more.click();
        fixture.detectChanges();
        http.expectOne(endpoint + '?page=0&size=100').flush({ items: Array.from({ length: 100 }, (_, index) => move(index)), page: 0, size: 100, total: 140 });
        await renderResources();
        expect(element.querySelectorAll('.moves li')).toHaveLength(100);
        expect(element.querySelector('.count')?.textContent).toBe('последние 100 из 140');
        expect(element.querySelector('.moves-block > button')).toBeNull();
    });
});
