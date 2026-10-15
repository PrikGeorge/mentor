import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SessionStore } from '../core/session.store';
import { student, lesson } from '../students/domain-test-support';
import { WorkspaceContext, WorkspaceSelection } from './workspace-context';

describe('Workspace selection ownership', () => {
    let context: WorkspaceContext;
    let session: SessionStore;
    let http: HttpTestingController;
    const card: WorkspaceSelection = { student, base: '/teacher/students/s1', preview: false, page: 'profile', learner: false };
    const lessonPage: WorkspaceSelection = { ...card, lesson, page: 'plan' };

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
        context = TestBed.inject(WorkspaceContext);
        session = TestBed.inject(SessionStore);
        http = TestBed.inject(HttpTestingController);
        loadAccount();
    });
    afterEach(() => {
        http.verify();
        TestBed.resetTestingModule();
    });

    function loadAccount(authVersion = 1) {
        session.load().subscribe();
        http.expectOne('/api/v1/auth/session').flush({
            account: { userId: 'synthetic-teacher', workspaceId: 'w1', role: 'TEACHER', authVersion },
            csrfToken: 'synthetic',
        });
    }

    it('keeps the newly opened lesson when the previous card is destroyed later', () => {
        const cardOwner = {},
            lessonOwner = {};
        expect(context.current()).toBeNull();
        context.set(cardOwner, card);
        context.set(lessonOwner, lessonPage);
        context.clear(cardOwner);
        expect(context.current()).toEqual(lessonPage);
        context.clear(lessonOwner);
        expect(context.current()).toBeNull();
        context.clear(lessonOwner);
        expect(context.current()).toBeNull();
    });

    it('replaces the current section and preview without retaining a previous lesson header', () => {
        const owner = {};
        context.set(owner, lessonPage);
        const preview = { ...card, preview: true, learner: true, page: 'goal' };
        context.set(owner, preview);
        expect(context.current()).toEqual(preview);
        expect(context.current()?.lesson).toBeUndefined();
        context.clear({});
        expect(context.current()).toEqual(preview);
    });

    it('hides the previous selection immediately on logout and does not revive it on the same account login', () => {
        const oldOwner = {},
            nextOwner = {};
        context.set(oldOwner, lessonPage);
        session.invalidate();
        expect(context.current()).toBeNull();
        loadAccount();
        expect(context.current()).toBeNull();
        context.set(nextOwner, card);
        context.clear(oldOwner);
        expect(context.current()).toEqual(card);
    });

    it('retains context on an unchanged session refresh but clears it when account authorization changes', () => {
        context.set({}, lessonPage);
        loadAccount();
        expect(context.current()).toEqual(lessonPage);
        loadAccount(2);
        expect(context.current()).toBeNull();
    });
});
