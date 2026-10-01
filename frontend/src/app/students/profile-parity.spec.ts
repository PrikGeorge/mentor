import { TestBed } from '@angular/core/testing';
import { configure, open, student, publicStudent, base } from './domain-test-support';
import type { components } from '../api/schema';
const profile: components['schemas']['MaterialMetadata'] = { id: 'synthetic-profile-doc', workspaceId: 'w1', studentId: 's1', lessonId: null, bundleId: null, audience: 'teacher', kind: 'doc', contentKey: 'profile', filename: 'profile.md', contentType: 'text/markdown', title: 'Synthetic doc' };
describe('Profile pages do not become lesson lists', () => {
    beforeEach(configure);
    afterEach(() => TestBed.resetTestingModule());
    for (const [section, title] of [['profile', 'Навыки и наблюдения'], ['projects', 'Учебные проекты'], ['career', 'Карьерный маршрут'], ['journal', 'Журнал обучения']])
        it(`opens matching ${section} without unrelated lesson requests`, async () => {
            const { fixture, http, element } = await open('/teacher/students/s1/' + section);
            try {
                http.expectOne(base).flush(student);
                const lessonReads = http.match(request => request.url.endsWith('/lessons'));
                for (const request of lessonReads)
                    request.flush({ items: [], page: 0, size: 25, total: 0 });
                expect(lessonReads).toHaveLength(0);
                fixture.detectChanges();
                http.expectOne(request => request.url.endsWith('/students/s1/materials')).flush({ items: [{ ...profile, contentKey: section }], page: 0, size: 25, total: 1 });
                http.expectOne(request => request.url.endsWith('/materials/synthetic-profile-doc')).flush({ ...profile, contentKey: section, document: { title: 'Synthetic', intro: '', raw: 'synthetic', html: '', sections: [{ id: 'section-0', title: 'Detail', html: '<p>ONLY_' + section + '</p>' }] } });
                fixture.detectChanges();
                expect(element.querySelector('main h1')?.textContent).toBe(title);
                expect(element.textContent).toContain('ONLY_' + section);
                expect(element.querySelector('nav[aria-label="Карточка ученика"] a[href$="/profile"]')).toBeTruthy();
                expect(element.querySelector('nav[aria-label="Карточка ученика"] a[href$="/projects"]')).toBeTruthy();
                expect(element.querySelector('nav[aria-label="Страницы занятий"]')).toBeNull();
                http.verify();
            }
            finally {
                fixture.destroy();
            }
        });
    it('adds teacher profile/projects links but keeps them out of public preview', async () => {
        const { fixture, http, element } = await open('/teacher/students/s1/roadmap?preview=student');
        try {
            http.expectOne(base + '?audience=student').flush(publicStudent);
            fixture.detectChanges();
            http.expectOne(request => request.url.endsWith('/students/s1/materials')).flush({ items: [], page: 0, size: 25, total: 0 });
            fixture.detectChanges();
            expect(element.querySelector('nav[aria-label="Кабинет ученика"] a[href$="/profile"]')).toBeNull();
            expect(element.querySelector('nav[aria-label="Кабинет ученика"] a[href$="/projects"]')).toBeNull();
            http.verify();
        }
        finally {
            fixture.destroy();
        }
    });
});
