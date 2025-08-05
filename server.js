const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Các biến toàn cục để lưu trữ dự đoán của các model
let modelPredictions = {};

// Hàm thuật toán 1: detectStreakAndBreak
function detectStreakAndBreak(history) {
    if (!history || history.length === 0) {
        return { 'streak': 0, 'currentResult': null, 'breakProb': 0 };
    }
    
    let streak = 1;
    const currentResult = history[history.length - 1]['result'];
    
    for (let i = history.length - 2; i >= 0; i--) {
        if (history[i]['result'] === currentResult) {
            streak++;
        } else {
            break;
        }
    }
    
    const recentResults = history.slice(-15).map(entry => entry.result);
    if (!recentResults.length) {
        return { 'streak': streak, 'currentResult': currentResult, 'breakProb': 0 };
    }
    
    const switches = recentResults.slice(1).reduce((count, result, index) => count + (result !== recentResults[index] ? 1 : 0), 0);
    const taiCount = recentResults.filter(result => result === 'Tài').length;
    const xiuCount = recentResults.filter(result => result === 'Xỉu').length;
    const balance = Math.abs(taiCount - xiuCount) / recentResults.length;
    
    let breakProb = 0;
    if (streak >= 8) {
        breakProb = Math.min(0.6 + switches / 15 + balance * 0.15, 0.9);
    } else if (streak >= 5) {
        breakProb = Math.min(0.35 + switches / 10 + balance * 0.25, 0.85);
    } else if (streak >= 3 && switches >= 7) {
        breakProb = 0.3;
    }
    
    return { 'streak': streak, 'currentResult': currentResult, 'breakProb': breakProb };
}

// Hàm thuật toán 2: evaluateModelPerformance
function evaluateModelPerformance(history, modelName, rounds = 10) {
    if (!modelPredictions[modelName] || history.length < 2) {
        return 1;
    }
    
    rounds = Math.min(rounds, history.length - 1);
    let correctPredictions = 0;
    
    for (let i = 0; i < rounds; i++) {
        const prediction = modelPredictions[modelName][history[history.length - (i + 2)].session] || 0;
        const actualResult = history[history.length - (i + 1)].result;
        
        if ((prediction === 1 && actualResult === 'Xỉu') || (prediction === 2 && actualResult === 'Tài')) {
            correctPredictions++;
        }
    }
    
    const accuracyScore = rounds > 0 ? 1 + (correctPredictions - rounds / 2) / (rounds / 2) : 1;
    return Math.min(1.5, Math.max(0.5, accuracyScore));
}

// Hàm thuật toán 3: smartBridgeBreak
function smartBridgeBreak(history) {
    if (!history || history.length < 3) {
        return { 'prediction': 0, 'breakProb': 0, 'reason': 'Không đủ dữ liệu để bẻ cầu' };
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    const recentResults = history.slice(-20).map(entry => entry.result);
    const recentScores = history.slice(-20).map(entry => entry.totalScore || 0);
    
    let prob = breakProb;
    let reason = '';
    
    const meanScore = recentScores.reduce((sum, score) => sum + score, 0) / (recentScores.length || 1);
    const meanDeviation = recentScores.reduce((sum, score) => sum + Math.abs(score - meanScore), 0) / (recentScores.length || 1);
    
    const recentFive = recentResults.slice(-5);
    const patterns = {};
    for (let i = 0; i <= recentResults.length - 3; i++) {
        const pattern = recentResults.slice(i, i + 3).join(',');
        patterns[pattern] = (patterns[pattern] || 0) + 1;
    }
    
    const mostFrequentPattern = Object.entries(patterns).sort((a, b) => b[1] - a[1])[0];
    const isRepeatingPattern = mostFrequentPattern && mostFrequentPattern[1] >= 3;
    
    if (streak >= 6) {
        prob = Math.min(prob + 0.15, 0.9);
        reason = '[Bẻ Cầu] Chuỗi ' + streak + ' ' + currentResult + ' dài, khả năng bẻ cầu cao';
    } else if (streak >= 4 && meanDeviation > 3) {
        prob = Math.min(prob + 0.1, 0.85);
        reason = '[Bẻ Cầu] Biến động điểm số lớn (' + meanDeviation.toFixed(1) + '), khả năng bẻ cầu tăng';
    } else if (isRepeatingPattern && recentFive.every(result => result === currentResult)) {
        prob = Math.min(prob + 0.05, 0.8);
        reason = '[Bẻ Cầu] Phát hiện mẫu lặp ' + mostFrequentPattern[0] + ', có khả năng bẻ cầu';
    } else {
        prob = Math.max(prob - 0.15, 0.15);
        reason = '[Bẻ Cầu] Không phát hiện mẫu bẻ cầu mạnh, tiếp tục theo cầu';
    }
    
    let prediction = prob > 0.65 ? (currentResult === 'Tài' ? 1 : 2) : (currentResult === 'Tài' ? 2 : 1);
    
    return { 'prediction': prediction, 'breakProb': prob, 'reason': reason };
}

// Hàm thuật toán 4: trendAndProb
function trendAndProb(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 5) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-15).map(entry => entry.result);
    if (!recentResults.length) {
        return 0;
    }
    
    const weights = recentResults.map((_, index) => Math.pow(1.2, index));
    const taiScore = weights.reduce((sum, weight, index) => sum + (recentResults[index] === 'Tài' ? weight : 0), 0);
    const xiuScore = weights.reduce((sum, weight, index) => sum + (recentResults[index] === 'Xỉu' ? weight : 0), 0);
    const totalScore = taiScore + xiuScore;
    
    const recentTen = history.slice(-10).map(entry => entry.result);
    const patterns = [];
    if (recentTen.length >= 4) {
        for (let i = 0; i <= recentTen.length - 4; i++) {
            patterns.push(recentTen.slice(i, i + 4).join(','));
        }
    }
    
    const patternCounts = patterns.reduce((counts, pattern) => {
        counts[pattern] = (counts[pattern] || 0) + 1;
        return counts;
    }, {});
    
    const mostFrequentPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
    
    if (mostFrequentPattern && mostFrequentPattern[1] >= 3) {
        const patternResults = mostFrequentPattern[0].split(',');
        return patternResults[patternResults.length - 1] !== recentTen[recentTen.length - 1] ? 2 : 1;
    } else if (totalScore > 0 && Math.abs(taiScore - xiuScore) / totalScore >= 0.25) {
        return taiScore > xiuScore ? 2 : 1;
    }
    
    return recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1;
}

// Hàm thuật toán 5: shortPattern
function shortPattern(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-8).map(entry => entry.result);
    if (!recentResults.length) {
        return 0;
    }
    
    const patterns = [];
    if (recentResults.length >= 3) {
        for (let i = 0; i <= recentResults.length - 3; i++) {
            patterns.push(recentResults.slice(i, i + 3).join(','));
        }
    }
    
    const patternCounts = patterns.reduce((counts, pattern) => {
        counts[pattern] = (counts[pattern] || 0) + 1;
        return counts;
    }, {});
    
    const mostFrequentPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
    
    if (mostFrequentPattern && mostFrequentPattern[1] >= 2) {
        const patternResults = mostFrequentPattern[0].split(',');
        return patternResults[patternResults.length - 1] !== recentResults[recentResults.length - 1] ? 2 : 1;
    }
    
    return recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1;
}

// Hàm thuật toán 6: meanDeviation
function meanDeviation(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-12).map(entry => entry.result);
    if (!recentResults.length) {
        return 0;
    }
    
    const taiCount = recentResults.filter(result => result === 'Tài').length;
    const xiuCount = recentResults.length - taiCount;
    const balance = Math.abs(taiCount - xiuCount) / recentResults.length;
    
    if (balance < 0.35) {
        return recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1;
    }
    
    return xiuCount > taiCount ? 2 : 1;
}

// Hàm thuật toán 7: recentSwitch
function recentSwitch(history) {
    if (!history || history.length < 3) {
        return 0;
    }
    
    const { streak, currentResult, breakProb } = detectStreakAndBreak(history);
    if (streak >= 4) {
        if (breakProb > 0.75) {
            return currentResult === 'Tài' ? 1 : 2;
        }
        return currentResult === 'Tài' ? 2 : 1;
    }
    
    const recentResults = history.slice(-10).map(entry => entry.result);
    if (!recentResults.length) {
        return 0;
    }
    
    const switches = recentResults.slice(1).reduce((count, result, index) => count + (result !== recentResults[index] ? 1 : 0), 0);
    
    return switches >= 6 ? (recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1) : (recentResults[recentResults.length - 1] === 'Xỉu' ? 2 : 1);
}

// Hàm thuật toán 8: isBadPattern
function isBadPattern(history) {
    if (!history || history.length < 3) {
        return false;
    }
    
    const recentResults = history.slice(-15).map(entry => entry.result);
    if (!recentResults.length) {
        return false;
    }
    
    const switches = recentResults.slice(1).reduce((count, result, index) => count + (result !== recentResults[index] ? 1 : 0), 0);
    const { streak } = detectStreakAndBreak(history);
    
    return switches >= 9 || streak >= 10;
}

// Hàm thuật toán 9: aiHtddLogic
function aiHtddLogic(history) {
    if (!history || history.length < 3) {
        const randomResult = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        return { 'prediction': randomResult, 'reason': '[AI] Không đủ lịch sử, dự đoán ngẫu nhiên', 'source': 'AI HTDD' };
    }
    
    const recentFive = history.slice(-5).map(entry => entry.result);
    const recentFiveScores = history.slice(-5).map(entry => entry.totalScore || 0);
    const taiCount = recentFive.filter(result => result === 'Tài').length;
    const xiuCount = recentFive.filter(result => result === 'Xỉu').length;
    
    if (history.length >= 3) {
        const recentThree = history.slice(-3).map(entry => entry.result);
        if (recentThree.join(',') === 'Tài,Xỉu,Tài') {
            return { 'prediction': 'Xỉu', 'reason': '[AI] Phát hiện mẫu 1T1X → tiếp theo nên đánh Xỉu', 'source': 'AI HTDD' };
        } else if (recentThree.join(',') === 'Xỉu,Tài,Xỉu') {
            return { 'prediction': 'Tài', 'reason': '[AI] Phát hiện mẫu 1X1T → tiếp theo nên đánh Tài', 'source': 'AI HTDD' };
        }
    }
    
    if (history.length >= 4) {
        const recentFour = history.slice(-4).map(entry => entry.result);
        if (recentFour.join(',') === 'Tài,Tài,Xỉu,Xỉu') {
            return { 'prediction': 'Tài', 'reason': '[AI] Phát hiện mẫu 2T2X → tiếp theo nên đánh Tài', 'source': 'AI HTDD' };
        } else if (recentFour.join(',') === 'Xỉu,Xỉu,Tài,Tài') {
            return { 'prediction': 'Xỉu', 'reason': '[AI] Phát hiện mẫu 2X2T → tiếp theo nên đánh Xỉu', 'source': 'AI HTDD' };
        }
    }
    
    if (history.length >= 9 && history.slice(-6).every(entry => entry.result === 'Tài')) {
        return { 'prediction': 'Xỉu', 'reason': '[AI] Chuỗi Tài quá dài (6 lần) → dự đoán Xỉu', 'source': 'AI HTDD' };
    } else if (history.length >= 9 && history.slice(-6).every(entry => entry.result === 'Xỉu')) {
        return { 'prediction': 'Tài', 'reason': '[AI] Chuỗi Xỉu quá dài (6 lần) → dự đoán Tài', 'source': 'AI HTDD' };
    }
    
    const averageScore = recentFiveScores.reduce((sum, score) => sum + score, 0) / (recentFiveScores.length || 1);
    if (averageScore > 10) {
        return { 'prediction': 'Tài', 'reason': '[AI] Điểm trung bình cao (' + averageScore.toFixed(1) + ') → dự đoán Tài', 'source': 'AI HTDD' };
    } else if (averageScore < 8) {
        return { 'prediction': 'Xỉu', 'reason': '[AI] Điểm trung bình thấp (' + averageScore.toFixed(1) + ') → dự đoán Xỉu', 'source': 'AI HTDD' };
    }
    
    if (taiCount > xiuCount + 1) {
        return { 'prediction': 'Xỉu', 'reason': '[AI] Tài chiếm đa số (' + taiCount + '/' + recentFive.length + ') → dự đoán Xỉu', 'source': 'AI HTDD' };
    } else if (xiuCount > taiCount + 1) {
        return { 'prediction': 'Tài', 'reason': '[AI] Xỉu chiếm đa số (' + xiuCount + '/' + recentFive.length + ') → dự đoán Tài', 'source': 'AI HTDD' };
    } else {
        const totalTai = history.filter(entry => entry.result === 'Tài').length;
        const totalXiu = history.filter(entry => entry.result === 'Xỉu').length;
        
        if (totalTai > totalXiu + 2) {
            return { 'prediction': 'Xỉu', 'reason': '[AI] Tổng thể Tài nhiều hơn → dự đoán Xỉu', 'source': 'AI HTDD' };
        } else if (totalXiu > totalTai + 2) {
            return { 'prediction': 'Tài', 'reason': '[AI] Tổng thể Xỉu nhiều hơn → dự đoán Tài', 'source': 'AI HTDD' };
        } else {
            const randomResult = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
            return { 'prediction': randomResult, 'reason': '[AI] Cân bằng, dự đoán ngẫu nhiên', 'source': 'AI HTDD' };
        }
    }
}

// Hàm thuật toán 10: generatePrediction
function generatePrediction(history, storedPredictions) {
    modelPredictions = storedPredictions;
    if (!history || history.length === 0) {
        console.log('No history available, generating random prediction');
        const randomPrediction = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        console.log('Random Prediction:', randomPrediction);
        return { prediction: randomPrediction, confidence: 0, reason: 'Không đủ lịch sử, dự đoán ngẫu nhiên', bridgeInfo: null };
    }
    
    if (!modelPredictions['trend']) {
        modelPredictions = {
            'trend': {},
            'short': {},
            'mean': {},
            'switch': {},
            'bridge': {}
        };
    }
    
    const lastSession = history[history.length - 1].session;
    
    const trendPrediction = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : trendAndProb(history);
    const shortPrediction = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : shortPattern(history);
    const meanPrediction = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : meanDeviation(history);
    const switchPrediction = history.length < 5 ? (history[history.length - 1].result === 'Tài' ? 2 : 1) : recentSwitch(history);
    const bridgePrediction = history.length < 5 ? { 'prediction': (history[history.length - 1].result === 'Tài' ? 2 : 1), 'breakProb': 0, 'reason': 'Lịch sử ngắn, dự đoán ngược lại' } : smartBridgeBreak(history);
    const aiHtddPrediction = aiHtddLogic(history);
    
    modelPredictions['trend'][lastSession] = trendPrediction;
    modelPredictions['short'][lastSession] = shortPrediction;
    modelPredictions['mean'][lastSession] = meanPrediction;
    modelPredictions['switch'][lastSession] = switchPrediction;
    modelPredictions['bridge'][lastSession] = bridgePrediction.prediction;
    
    const modelWeights = {
        'trend': evaluateModelPerformance(history, 'trend'),
        'short': evaluateModelPerformance(history, 'short'),
        'mean': evaluateModelPerformance(history, 'mean'),
        'switch': evaluateModelPerformance(history, 'switch'),
        'bridge': evaluateModelPerformance(history, 'bridge')
    };
    
    const scaledWeights = {
        'trend': 0.2 * modelWeights['trend'],
        'short': 0.2 * modelWeights['short'],
        'mean': 0.25 * modelWeights['mean'],
        'switch': 0.2 * modelWeights['switch'],
        'bridge': 0.15 * modelWeights['bridge'],
        'aihtdd': 0.2
    };
    
    let xiuWeight = 0;
    let taiWeight = 0;
    
    if (trendPrediction === 1) xiuWeight += scaledWeights['trend'];
    else if (trendPrediction === 2) taiWeight += scaledWeights['trend'];
    
    if (shortPrediction === 1) xiuWeight += scaledWeights['short'];
    else if (shortPrediction === 2) taiWeight += scaledWeights['short'];
    
    if (meanPrediction === 1) xiuWeight += scaledWeights['mean'];
    else if (meanPrediction === 2) taiWeight += scaledWeights['mean'];
    
    if (switchPrediction === 1) xiuWeight += scaledWeights['switch'];
    else if (switchPrediction === 2) taiWeight += scaledWeights['switch'];
    
    if (bridgePrediction.prediction === 1) xiuWeight += scaledWeights['bridge'];
    else if (bridgePrediction.prediction === 2) taiWeight += scaledWeights['bridge'];
    
    if (aiHtddPrediction.prediction === 'Tài') taiWeight += scaledWeights['aihtdd'];
    else xiuWeight += scaledWeights['aihtdd'];
    
    if (isBadPattern(history)) {
        console.log('Bad pattern detected, reducing confidence');
        xiuWeight *= 0.8;
        taiWeight *= 0.8;
    }
    
    const recentTen = history.slice(-10).map(entry => entry.result);
    const taiInRecentTen = recentTen.filter(result => result === 'Tài').length;
    if (taiInRecentTen >= 7) {
        taiWeight += 0.15;
        console.log('Adjusting for too many Tài predictions');
    } else if (taiInRecentTen <= 3) {
        xiuWeight += 0.15;
        console.log('Adjusting for too many Xỉu predictions');
    }
    
    if (bridgePrediction.breakProb > 0.65) {
        console.log('High bridge break probability:', bridgePrediction.breakProb, bridgePrediction.reason);
        if (bridgePrediction.prediction === 1) taiWeight += 0.2;
        else if (bridgePrediction.prediction === 2) xiuWeight += 0.2;
    }
    
    let finalPrediction;
    let finalReason;
    let confidence;
    
    const totalWeight = taiWeight + xiuWeight;
    
    if (taiWeight > xiuWeight) {
        finalPrediction = 'Tài';
        finalReason = '[Final] Dự đoán Tài với tổng trọng số ' + taiWeight.toFixed(2) + ' so với ' + xiuWeight.toFixed(2) + ' của Xỉu';
        confidence = totalWeight > 0 ? (taiWeight / totalWeight) : 0.5;
    } else if (xiuWeight > taiWeight) {
        finalPrediction = 'Xỉu';
        finalReason = '[Final] Dự đoán Xỉu với tổng trọng số ' + xiuWeight.toFixed(2) + ' so với ' + taiWeight.toFixed(2) + ' của Tài';
        confidence = totalWeight > 0 ? (xiuWeight / totalWeight) : 0.5;
    } else {
        finalPrediction = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
        finalReason = '[Final] Trọng số cân bằng, dự đoán ngẫu nhiên';
        confidence = 0.5;
    }
    
    const finalConfidence = Math.max(0, Math.min(100, Math.round(confidence * 100)));
    
    console.log('Prediction:', finalPrediction);
    console.log('Reason:', finalReason);
    
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        reason: finalReason,
        bridgeInfo: bridgePrediction
    };
}

// API Endpoint
app.get('/api/predict', async (req, res) => {
    const originalApiUrl = 'https://binhtool90-hitclub-predict.onrender.com/api/taixiu';
    
    try {
        const response = await axios.get(originalApiUrl);
        const history = response.data;
        
        if (!history || history.length === 0) {
            return res.status(404).json({ error: 'Không tìm thấy lịch sử từ API gốc.' });
        }
        
        const lastEntry = history[history.length - 1];
        
        // Chạy thuật toán dự đoán
        const { prediction, confidence, reason, bridgeInfo } = generatePrediction(history, modelPredictions);
        
        // Chuẩn bị dữ liệu trả về theo định dạng yêu cầu, đã bỏ trường xuc_xac
        const finalResponse = {
            phien_truoc: lastEntry.Phien,
            Tong: lastEntry.totalScore,
            ket_qua: lastEntry.Ket_qua,
            phien_sau: lastEntry.Phien + 1,
            du_doan: prediction,
            do_tin_cay: confidence,
            giai_thich: bridgeInfo ? bridgeInfo.reason : reason,
            id: 'Tele@CsTool001'
        };
        
        res.json(finalResponse);
        
    } catch (error) {
        console.error('Lỗi khi gọi API gốc hoặc xử lý dữ liệu:', error.message);
        res.status(500).json({ error: 'Lỗi server nội bộ' });
    }
});

// Khởi động server
app.listen(PORT, () => {
    console.log(`Server đang chạy trên http://localhost:${PORT}`);
});
