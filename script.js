// 질문 데이터 저장소 (로컬 스토리지 사용)
let questions = [];

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    loadQuestions();
    setupEventListeners();
    renderQuestions();
});

// 이벤트 리스너 설정
function setupEventListeners() {
    // 질문 작성 폼
    const questionForm = document.getElementById('questionForm');
    questionForm.addEventListener('submit', handleQuestionSubmit);

    // 필터 변경
    const filterSubject = document.getElementById('filterSubject');
    filterSubject.addEventListener('change', renderQuestions);
}

// 질문 제출 처리
function handleQuestionSubmit(e) {
    e.preventDefault();
    
    const subject = document.getElementById('subject').value;
    const title = document.getElementById('title').value;
    const content = document.getElementById('content').value;

    if (!subject || !title || !content) {
        alert('모든 필드를 입력해주세요.');
        return;
    }

    const newQuestion = {
        id: Date.now(),
        subject: subject,
        title: title,
        content: content,
        date: new Date().toLocaleString('ko-KR'),
        answers: []
    };

    questions.push(newQuestion);
    saveQuestions();
    renderQuestions();
    
    // 폼 초기화
    questionForm.reset();
    
    // 성공 메시지
    showMessage('질문이 등록되었습니다!', 'success');
}

// 답변 제출 처리
function handleAnswerSubmit(questionId, answerTextarea) {
    const answerContent = answerTextarea.value.trim();
    
    if (!answerContent) {
        alert('답변 내용을 입력해주세요.');
        return;
    }

    const question = questions.find(q => q.id === questionId);
    if (question) {
        const newAnswer = {
            id: Date.now(),
            content: answerContent,
            date: new Date().toLocaleString('ko-KR')
        };
        
        question.answers.push(newAnswer);
        saveQuestions();
        renderQuestions();
        showMessage('답변이 등록되었습니다!', 'success');
    }
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
    
    // 최신순 정렬
    filteredQuestions = [...filteredQuestions].sort((a, b) => b.id - a.id);
    
    if (filteredQuestions.length === 0) {
        questionsList.innerHTML = `
            <div class="empty-state">
                <h3>📝 질문이 없습니다</h3>
                <p>첫 번째 질문을 작성해보세요!</p>
            </div>
        `;
        return;
    }
    
    questionsList.innerHTML = filteredQuestions.map(question => `
        <div class="question-card">
            <div class="question-header">
                <div>
                    <span class="question-subject">${escapeHtml(question.subject)}</span>
                    <h3 class="question-title">${escapeHtml(question.title)}</h3>
                </div>
            </div>
            <div class="question-meta">
                <span>📅 ${question.date}</span>
            </div>
            <div class="question-content">${escapeHtml(question.content)}</div>
            
            <div class="answers-section">
                <div class="answers-header">
                    <span class="answers-title">답변</span>
                    <span class="answer-count">${question.answers.length}개</span>
                </div>
                
                <div class="answers-list" id="answers-${question.id}">
                    ${question.answers.map(answer => `
                        <div class="answer-card">
                            <div class="answer-content">${escapeHtml(answer.content)}</div>
                            <div class="answer-meta">${answer.date}</div>
                        </div>
                    `).join('')}
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
                        onclick="handleAnswerSubmit(${question.id}, document.getElementById('answer-${question.id}'))"
                    >
                        답변 등록
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

// HTML 이스케이프 (XSS 방지)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 로컬 스토리지에 저장
function saveQuestions() {
    localStorage.setItem('questions', JSON.stringify(questions));
}

// 로컬 스토리지에서 불러오기
function loadQuestions() {
    const saved = localStorage.getItem('questions');
    if (saved) {
        try {
            questions = JSON.parse(saved);
        } catch (e) {
            console.error('질문 데이터를 불러오는 중 오류가 발생했습니다.', e);
            questions = [];
        }
    }
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

