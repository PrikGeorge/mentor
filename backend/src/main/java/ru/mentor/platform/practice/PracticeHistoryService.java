package ru.mentor.platform.practice;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.*;

@Service
public class PracticeHistoryService {
    private final PracticeAuthority authority;
    private final PracticeHistoryRepository repository;
    public PracticeHistoryService(PracticeAuthority authority, PracticeHistoryRepository repository) {
        this.authority=authority;this.repository=repository;
    }

    // History survives catalog/assignment removal. Current lesson ownership still gates every read.
    @Transactional(propagation=Propagation.REQUIRES_NEW,isolation=Isolation.REPEATABLE_READ,readOnly=true)
    public Page<PracticeHistoryRepository.Entry> list(Actor actor, LessonRef lesson, int page, int size, String audience) {
        authority.reader(actor,lesson);
        PracticeAuthority.audience(audience);
        if(page<0 || size<1 || size>100) throw new IllegalArgumentException("Invalid pagination.");
        return repository.list(lesson,page,size);
    }
}
