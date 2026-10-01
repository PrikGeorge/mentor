import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DocumentNavigationComponent } from './document-navigation.component';
@Component({ imports: [DocumentNavigationComponent], template: `<div class="material-document"><mentor-document-navigation [sections]="sections"/><details class="explanation-details"><summary>Пояснение</summary><section id="section-0"><h2>Часть</h2></section></details><details open><summary>Открыто</summary><p>Текст</p></details></div>` })
class DocumentFixture { sections = [{ id: 'section-0', title: 'Часть', html: '' }]; }
describe('Document anchor and print state', () => {
    beforeEach(() => TestBed.configureTestingModule({ imports: [DocumentFixture], providers: [provideRouter([])] }));
    afterEach(() => TestBed.resetTestingModule());
    it('opens ancestor disclosures, focuses heading, and restores every print state', () => {
        const fixture = TestBed.createComponent(DocumentFixture); fixture.detectChanges();
        const element: HTMLElement = fixture.nativeElement; const details = Array.from(element.querySelectorAll<HTMLDetailsElement>('.material-document > details'));
        window.dispatchEvent(new Event('beforeprint')); expect(details.map(d => d.open)).toEqual([true, true]); window.dispatchEvent(new Event('beforeprint')); window.dispatchEvent(new Event('afterprint')); expect(details.map(d => d.open)).toEqual([false, true]);
        element.querySelector<HTMLAnchorElement>('nav a')!.click(); expect(details[0].open).toBe(true); expect(document.activeElement?.textContent).toBe('Часть');
    });
});
