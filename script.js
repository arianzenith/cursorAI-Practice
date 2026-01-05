// 질문 데이터 저장소 (Firebase Firestore 사용)
let questions = [];

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadQuestionsFromFirebase();
});

// 이벤트 리스너 설정
function setupEventListeners() {
    // 질문 작성 폼
    const questionForm = document.getElementById('questionForm');
    questionForm.addEventListener('submit', handleQuestionSubmit);

    // 필터 변경
    const filterSubject = document.getElementById('filterSubject');
    filterSubject.addEventListener('change', renderQuestions);

    // 글자 수 카운터
    const titleInput = document.getElementById('title');
    const contentTextarea = document.getElementById('content');
    
    titleInput.addEventListener('input', () => {
        document.getElementById('titleCount').textContent = titleInput.value.length;
    });
    
    contentTextarea.addEventListener('input', () => {
        document.getElementById('contentCount').textContent = contentTextarea.value.length;
    });
}

// 질문 제출 처리
async function handleQuestionSubmit(e) {
    e.preventDefault();
    
    const subject = document.getElementById('subject').value;
    const title = document.getElementById('title').value;
    const content = document.getElementById('content').value;

    if (!subject || !title || !content) {
        alert('모든 필드를 입력해주세요.');
        return;
    }

    try {
        // 입력 데이터 검증
        if (title.length > 200) {
            showMessage('제목은 200자 이하여야 합니다.', 'error');
            return;
        }
        if (content.length > 5000) {
            showMessage('내용은 5000자 이하여야 합니다.', 'error');
            return;
        }

        const newQuestion = {
            subject: subject,
            title: title.trim(),
            content: content.trim(),
            date: new Date().toISOString(),
            dateFormatted: new Date().toLocaleString('ko-KR'),
            answers: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Firestore에 질문 추가
        await db.collection('questions').add(newQuestion);
        
        // 폼 초기화
        document.getElementById('questionForm').reset();
        
        // 성공 메시지
        showMessage('질문이 등록되었습니다!', 'success');
        
        // 질문 목록 새로고침
        loadQuestionsFromFirebase();
    } catch (error) {
        console.error('질문 등록 중 오류:', error);
        showMessage('질문 등록에 실패했습니다.', 'error');
    }
}

// 답변 제출 처리
async function handleAnswerSubmit(questionId, answerTextarea) {
    const answerContent = answerTextarea.value.trim();
    
    if (!answerContent) {
        alert('답변 내용을 입력해주세요.');
        return;
    }

    try {
        // 답변 길이 검증
        if (answerContent.length > 5000) {
            showMessage('답변은 5000자 이하여야 합니다.', 'error');
            return;
        }

        // 질문 문서 가져오기 (답변 개수 확인)
        const questionDoc = await db.collection('questions').doc(questionId).get();
        if (!questionDoc.exists) {
            showMessage('질문을 찾을 수 없습니다.', 'error');
            return;
        }

        const questionData = questionDoc.data();
        if ((questionData.answers || []).length >= 100) {
            showMessage('답변은 최대 100개까지 등록할 수 있습니다.', 'error');
            return;
        }

        const newAnswer = {
            content: answerContent.trim(),
            date: new Date().toISOString(),
            dateFormatted: new Date().toLocaleString('ko-KR'),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        // Firestore의 질문 문서에 답변 추가
        const questionRef = db.collection('questions').doc(questionId);
        await questionRef.update({
            answers: firebase.firestore.FieldValue.arrayUnion(newAnswer)
        });
        
        // 텍스트 영역 초기화
        answerTextarea.value = '';
        
        showMessage('답변이 등록되었습니다!', 'success');
        
        // 질문 목록 새로고침
        loadQuestionsFromFirebase();
    } catch (error) {
        console.error('답변 등록 중 오류:', error);
        showMessage('답변 등록에 실패했습니다.', 'error');
    }
}

// Firebase에서 질문 목록 불러오기
function loadQuestionsFromFirebase() {
    // 로딩 표시
    const questionsList = document.getElementById('questionsList');
    questionsList.innerHTML = '<div class="empty-state"><p><span class="loading-spinner"></span>질문을 불러오는 중...</p></div>';
    
    // Firestore에서 실시간으로 질문 가져오기
    let query = db.collection('questions');
    
    // createdAt 필드로 정렬 시도 (인덱스가 없으면 오류 발생 가능)
    query = query.orderBy('createdAt', 'desc');
    
    query.onSnapshot((snapshot) => {
        questions = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            questions.push({
                id: doc.id,
                ...data
            });
        });
        renderQuestions();
    }, (error) => {
        console.error('질문 불러오기 오류:', error);
        
        // 인덱스 오류인 경우 클라이언트 측 정렬로 대체
        if (error.code === 'failed-precondition') {
            console.warn('인덱스가 필요합니다. 클라이언트 측 정렬을 사용합니다.');
            // 인덱스 없이 데이터 가져오기
            db.collection('questions')
                .get()
                .then((snapshot) => {
                    questions = [];
                    snapshot.forEach((doc) => {
                        const data = doc.data();
                        questions.push({
                            id: doc.id,
                            ...data
                        });
                    });
                    // 클라이언트 측에서 정렬
                    questions.sort((a, b) => {
                        const dateA = a.createdAt?.toDate?.() || new Date(a.date || 0);
                        const dateB = b.createdAt?.toDate?.() || new Date(b.date || 0);
                        return dateB - dateA;
                    });
                    renderQuestions();
                })
                .catch((err) => {
                    console.error('질문 불러오기 오류:', err);
                    showMessage('질문을 불러오는데 실패했습니다.', 'error');
                    questionsList.innerHTML = '<div class="empty-state"><h3>❌ 오류가 발생했습니다</h3><p>페이지를 새로고침해주세요.</p></div>';
                });
        } else {
            showMessage('질문을 불러오는데 실패했습니다.', 'error');
            questionsList.innerHTML = '<div class="empty-state"><h3>❌ 오류가 발생했습니다</h3><p>페이지를 새로고침해주세요.</p></div>';
        }
    });
}

// 질문 목록 렌더링
function renderQuestions() {
    const questionsList = document.getElementById('questionsList');
    const filterSubject = document.getElementById('filterSubject').value;
    
    // 필터링
    let filteredQuestions = questions;
    if (filterSubject !== 'all') {
        filteredQuestions = questions.filter(q => q.subject === filterSubject);
    }
    
    // 최신순 정렬 (이미 Firestore에서 정렬되어 있지만, 추가 정렬)
    filteredQuestions = [...filteredQuestions].sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(a.date || 0);
        const dateB = b.createdAt?.toDate?.() || new Date(b.date || 0);
        return dateB - dateA;
    });
    
    if (filteredQuestions.length === 0) {
        questionsList.innerHTML = `
            <div class="empty-state">
                <h3>📝 질문이 없습니다</h3>
                <p>첫 번째 질문을 작성해보세요!</p>
            </div>
        `;
        return;
    }
    
    questionsList.innerHTML = filteredQuestions.map(question => {
        const displayDate = question.dateFormatted || 
                          (question.createdAt?.toDate?.()?.toLocaleString('ko-KR')) || 
                          question.date || 
                          '날짜 없음';
        
        return `
        <div class="question-card">
            <div class="question-header">
                <div>
                    <span class="question-subject">${escapeHtml(question.subject)}</span>
                    <h3 class="question-title">${escapeHtml(question.title)}</h3>
                </div>
            </div>
            <div class="question-meta">
                <span>📅 ${displayDate}</span>
            </div>
            <div class="question-content">${escapeHtml(question.content)}</div>
            
            <div class="answers-section">
                <div class="answers-header">
                    <span class="answers-title">답변</span>
                    <span class="answer-count">${(question.answers || []).length}개</span>
                </div>
                
                <div class="answers-list" id="answers-${question.id}">
                    ${(question.answers || []).map(answer => {
                        const answerDate = answer.dateFormatted || answer.date || '날짜 없음';
                        return `
                        <div class="answer-card">
                            <div class="answer-content">${escapeHtml(answer.content)}</div>
                            <div class="answer-meta">${answerDate}</div>
                        </div>
                        `;
                    }).join('')}
                </div>
                
                <div class="answer-form">
                    <textarea 
                        id="answer-${question.id}" 
                        placeholder="답변을 입력하세요..."
                        rows="3"
                    ></textarea>
                    <button 
                        type="button" 
                        class="btn-secondary"
                        onclick="handleAnswerSubmit('${question.id}', document.getElementById('answer-${question.id}'))"
                    >
                        답변 등록
                    </button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// HTML 이스케이프 (XSS 방지)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 메시지 표시 (간단한 알림)
function showMessage(message, type) {
    // 간단한 알림 (실제로는 더 나은 UI로 개선 가능)
    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#28a745' : '#dc3545'};
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => messageDiv.remove(), 300);
    }, 2000);
}

// CSS 애니메이션 추가
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
