import { renderResources } from '../students/domain-test-support';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MaterialViewComponent } from './material-view.component';
import { SessionStore } from '../core/session.store';
import { sessionInterceptor } from '../core/session.interceptor';
import type { components } from '../api/schema';
type Metadata = components['schemas']['MaterialMetadata'];
const meta: Metadata = { id: 'profile-doc', workspaceId: 'w1', studentId: 's1', lessonId: null, bundleId: null, audience: 'teacher', kind: 'doc', contentKey: 'profile', filename: 'profile.md', contentType: 'text/markdown', title: 'Synthetic profile' };
const doc = (m: Metadata, html: string): components['schemas']['DocMaterialView'] => ({ ...m, kind: 'doc', document: { title: m.title ?? '', intro: '', raw: 'synthetic only', html: '', sections: [{ id: 'section-0', title: 'Synthetic section', html }] } });
function open(section: string, publicView = false, role: 'TEACHER' | 'STUDENT' = 'TEACHER', lessonId: string | null = null) {
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).load().subscribe();
    http.expectOne('/api/v1/auth/session').flush({ account: { userId: 'synthetic-' + role, workspaceId: 'w1', role, authVersion: 1 }, csrfToken: 'synthetic' });
    const fixture = TestBed.createComponent(MaterialViewComponent);
    fixture.componentRef.setInput('workspaceId', 'w1');
    fixture.componentRef.setInput('studentId', 's1');
    fixture.componentRef.setInput('lessonId', lessonId);
    fixture.componentRef.setInput('section', section);
    fixture.componentRef.setInput('base', (role === 'STUDENT' ? '/learn' : '/teacher') + '/students/s1' + (lessonId ? '/lessons/' + lessonId : ''));
    fixture.componentRef.setInput('preview', publicView && role === 'TEACHER');
    fixture.componentRef.setInput('learner', publicView);
    fixture.detectChanges();
    return { http, fixture, element: fixture.nativeElement as HTMLElement };
}
describe('Imported profile and view parity', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [MaterialViewComponent], providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionInterceptor])), provideHttpClientTesting()] }));
    afterEach(() => { TestBed.inject(HttpTestingController).verify(); TestBed.resetTestingModule(); });
    for (const role of ['TEACHER', 'STUDENT'] as const) {
        it(`selects only the public student-roadmap in ${role} public view`, async () => {
            const { http, fixture, element } = open('roadmap', true, role);
            try {
                const publicDoc = { ...meta, id: 'public-roadmap', audience: 'student' as const, contentKey: 'student-roadmap' };
                http.expectOne(request => request.url.endsWith('/students/s1/materials')).flush({ items: [publicDoc], page: 0, size: 25, total: 1 });
                const reads = http.match(request => request.url.endsWith('/materials/public-roadmap'));
                expect(reads).toHaveLength(1);
                reads[0].flush(doc(publicDoc, '<p>PUBLIC_ROADMAP</p>'));
                await renderResources(); fixture.detectChanges();
                expect(element.textContent).toContain('PUBLIC_ROADMAP');
                http.expectNone(request => request.url.includes('/lessons/'));
            }
            finally {
                fixture.destroy();
            }
        });
        it(`reaches public goalHtml from an arbitrary profile view key for ${role}`, async () => {
            const { http, fixture, element } = open('goal', true, role);
            try {
                const publicView = { ...meta, id: 'public-profile-view', kind: 'view' as const, audience: 'student' as const, contentKey: 'synthetic-card-key' };
                http.expectOne(request => request.url.endsWith('/students/s1/materials')).flush({ items: [publicView], page: 0, size: 25, total: 1 });
                const reads = http.match(request => request.url.endsWith('/materials/public-profile-view'));
                expect(reads).toHaveLength(1);
                reads[0].flush({ ...publicView, viewData: { goalHtml: '<p>PUBLIC_GOAL</p>', lessonHtml: 'PRIVATE_LESSON', reviewHtml: 'PRIVATE_REVIEW', profileFacts: 'PRIVATE_FACTS', answersCards: [['PrivateAnswer', 'PRIVATE_ANSWER', 'Private']] } });
                await renderResources(); fixture.detectChanges();
                expect(element.textContent).toContain('PUBLIC_GOAL');
                expect(element.textContent).not.toContain('PRIVATE_');
                expect(TestBed.inject(SessionStore).actor()?.role).toBe(role);
            }
            finally {
                fixture.destroy();
            }
        });
    }
    it('shows every applicable teacher view field and exact scoped descriptor/resource/answer targets', async () => {
        const { http, fixture, element } = open('plan', false, 'TEACHER', 'l1');
        try {
            const view = { ...meta, id: 'teacher-view', lessonId: 'l1', bundleId: 'bundle', kind: 'view' as const, contentKey: 'legacy-teacher-view' }, guide = { ...meta, id: 'exact-guide-id', lessonId: 'l1', bundleId: 'bundle', contentKey: 'guide' }, answer = { ...guide, id: 'exact-answer-id', kind: 'code' as const, contentKey: 'ListSolutions' };
            http.expectOne(request => request.url.endsWith('/lessons/l1/materials')).flush({ items: [{ ...answer, id: 'wrong-lesson-answer', lessonId: 'other' }, view, guide, answer], page: 0, size: 25, total: 4 });
            const reads = http.match(request => request.url.endsWith('/materials/teacher-view'));
            expect(reads).toHaveLength(1);
            reads[0].flush({ ...view, viewData: { lessonHtml: '<p>TEACHER_LESSON</p>', reviewHtml: '<p>TEACHER_REVIEW</p>', profileFacts: '<p>TEACHER_FACTS</p>', descriptors: { guide: ['Synthetic descriptor', 'DESC_MARKER'] }, resources: [['guide', 'Synthetic resource', 'Guide resource', 'RESOURCE_MARKER'], ['answers', 'Answers', 'Answer resource', 'ANSWER_RESOURCE']], answersCards: [['ListSolutions', 'Synthetic answer', 'ANSWER_CARD']] } });
            await renderResources(); fixture.detectChanges();
            for (const marker of ['TEACHER_LESSON', 'TEACHER_REVIEW', 'TEACHER_FACTS', 'DESC_MARKER', 'RESOURCE_MARKER', 'ANSWER_CARD'])
                expect(element.textContent).toContain(marker);
            const hrefs = Array.from(element.querySelectorAll('a')).map(link => link.getAttribute('href'));
            expect(hrefs.some(href => href?.includes('/teacher/materials/exact-guide-id'))).toBe(true);
            expect(hrefs.some(href => href?.includes('/teacher/materials/exact-answer-id'))).toBe(true);
            expect(hrefs.some(href => href?.includes('/teacher/materials/teacher-view#material-answers'))).toBe(true);
            expect(hrefs.some(href => href?.includes('wrong-lesson-answer'))).toBe(false);
        }
        finally {
            fixture.destroy();
        }
    });
    it('resolves profile core/course references through exact authorized material IDs and keeps section fragments', async () => {
        const { http, fixture, element } = open('profile');
        const router = TestBed.inject(Router), navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
        try {
            const core = { ...meta, id: 'exact-core-id', contentKey: 'core' }, course = { ...meta, id: 'exact-course-id', contentKey: 'course' };
            http.expectOne(request => request.url.endsWith('/students/s1/materials')).flush({ items: [meta, core, course], page: 0, size: 25, total: 3 });
            http.expectOne(request => request.url.endsWith('/materials/profile-doc')).flush(doc(meta, '<a href="#core/section-0">Core</a><a href="#course">Course</a><a href="#unknown-admin">Unknown</a>'));
            await renderResources(); fixture.detectChanges();
            element.querySelector<HTMLAnchorElement>('a')!.click();
            expect(router.serializeUrl(navigate.mock.calls[0][0] as ReturnType<Router['createUrlTree']>)).toBe('/teacher/students/s1/materials/exact-core-id#section-0');
            element.querySelectorAll<HTMLAnchorElement>('a')[1].click();
            expect(router.serializeUrl(navigate.mock.calls[1][0] as ReturnType<Router['createUrlTree']>)).toBe('/teacher/students/s1/materials/exact-course-id');
            element.querySelectorAll<HTMLAnchorElement>('a')[2].click();
            expect(navigate).toHaveBeenCalledTimes(2);
        }
        finally {
            fixture.destroy();
        }
    });
    it('retains the scoped teacher profileFacts appendix beside the prepared profile document', async () => {
        const { http, fixture, element } = open('profile');
        try {
            const view = { ...meta, id: 'profile-teacher-view', kind: 'view' as const, contentKey: 'legacy-teacher-view' };
            http.expectOne(request => request.url.endsWith('/students/s1/materials')).flush({ items: [meta, view], page: 0, size: 25, total: 2 });
            http.expectOne(request => request.url.endsWith('/materials/profile-doc')).flush(doc(meta, '<p>PROFILE_DOC</p>'));
            const reads = http.match(request => request.url.endsWith('/materials/profile-teacher-view'));
            expect(reads).toHaveLength(1);
            reads[0].flush({ ...view, viewData: { profileFacts: '<p>SCOPED_PROFILE_FACTS</p>' } });
            await renderResources(); fixture.detectChanges();
            expect(element.textContent).toContain('PROFILE_DOC');
            expect(element.textContent).toContain('SCOPED_PROFILE_FACTS');
            http.expectNone(request => request.url.includes('/lessons/'));
        }
        finally {
            fixture.destroy();
        }
    });
    for (const [publicView, section, title] of [[false, 'plan', 'План и ревью занятия'], [true, 'goal', 'Цель обучения']] as const) {
        it(`labels imported ${section} view consistently in discovery and reading without modifying its payload`, async () => {
            const lessonId = publicView ? null : 'l1';
            const { http, fixture, element } = open('materials', publicView, publicView ? 'STUDENT' : 'TEACHER', lessonId);
            try {
                const view = { ...meta, id: 'imported-view', lessonId, kind: 'view' as const, contentKey: publicView ? 'synthetic-card-key' : 'legacy-teacher-view', audience: publicView ? 'student' as const : 'teacher' as const, title: publicView ? 'content.json' : 'Legacy teacher view', filename: 'content.json' };
                const plainDoc = { ...meta, lessonId, audience: view.audience, title: 'Preserved document title' };
                http.expectOne(request => request.url.endsWith('/materials')).flush({ items: [view, plainDoc], page: 0, size: 25, total: 2 });
                await renderResources(); fixture.detectChanges();
                expect(element.textContent).toContain(title);
                expect(element.textContent).toContain('Preserved document title');
                expect(element.textContent).not.toContain(view.title);
                fixture.componentRef.setInput('section', section); await renderResources(); fixture.detectChanges();
                http.expectOne(request => request.url.endsWith('/materials')).flush({ items: [view], page: 0, size: 25, total: 1 });
                http.expectOne(request => request.url.endsWith('/materials/imported-view')).flush({ ...view, viewData: publicView ? { goalHtml: '<p>GOAL</p>' } : { lessonHtml: '<p>PLAN</p>' } });
                await renderResources(); fixture.detectChanges();
                expect(element.querySelector('.material-document h2')?.textContent).toBe(title);
                expect(view.title).toBe(publicView ? 'content.json' : 'Legacy teacher view');
            } finally { fixture.destroy(); }
        });
    }
});
