import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Image as ImageIcon, AlertTriangle, CheckCircle2, Send, Loader2, ThumbsUp, Share2, MoreVertical, Trash2, Award } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { db, collection, onSnapshot, query, orderBy, limit, addDoc, serverTimestamp, handleFirestoreError, OperationType } from '../services/firebase';

interface Post {
  id: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  content: string;
  type: 'SafetyMoment' | 'Tip' | 'SuccessStory' | 'Warning';
  likes: string[];
  imageUrl?: string;
  createdAt: any;
  projectId: string;
}

const typeMapping: Record<string, Post['type']> = {
  'info': 'Tip',
  'alert': 'Warning',
  'success': 'SuccessStory',
  'event': 'SafetyMoment'
};

const reverseTypeMapping: Record<Post['type'], string> = {
  'Tip': 'info',
  'Warning': 'alert',
  'SuccessStory': 'success',
  'SafetyMoment': 'event'
};

export function MuralDinamico() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { nodes } = useRiskEngine();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPostContent, setNewPostContent] = useState('');
  const [postType, setPostType] = useState<string>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedProject) return;

    const path = `projects/${selectedProject.id}/safety_posts`;
    const q = query(
      collection(db, path),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPosts(snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      })) as Post[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, path));

    return () => unsubscribe();
  }, [selectedProject]);

  const handlePostSubmit = async () => {
    if (!newPostContent.trim() || !selectedProject || !user) return;
    setIsSubmitting(true);

    const path = `projects/${selectedProject.id}/safety_posts`;
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        userName: user.displayName || user.email || 'Usuario',
        userPhoto: user.photoURL || '',
        content: newPostContent,
        type: typeMapping[postType] || 'Tip',
        likes: [],
        createdAt: serverTimestamp(),
        projectId: selectedProject.id
      });

      setNewPostContent('');
      setPostType('info');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPostIcon = (type: string) => {
    switch (type) {
      case 'Warning':
      case 'alert': return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'SuccessStory':
      case 'success': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'SafetyMoment':
      case 'event': return <MessageSquare className="w-5 h-5 text-blue-500" />;
      default: return <MessageSquare className="w-5 h-5 text-zinc-400" />;
    }
  };

  const getPostColor = (type: string) => {
    switch (type) {
      case 'Warning':
      case 'alert': return 'border-amber-500/20 bg-amber-500/5';
      case 'SuccessStory':
      case 'success': return 'border-emerald-500/20 bg-emerald-500/5';
      case 'SafetyMoment':
      case 'event': return 'border-blue-500/20 bg-blue-500/5';
      default: return 'border-white/5 bg-zinc-900/50';
    }
  };

  // Convert Firestore post to UI-friendly format if needed, 
  // but we can use them directly with a bit of defensive check
  const displayPosts = [...posts].sort((a, b) => {
    const timeA = a.createdAt?.toMillis?.() || 0;
    const timeB = b.createdAt?.toMillis?.() || 0;
    return timeB - timeA;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Mural Dinámico</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Centro de Comando y Comunicación Táctica
          </p>
        </div>
      </div>

      {/* Post Composer */}
      <Card className="p-4 sm:p-6">
        <div className="space-y-4">
          <textarea
            value={newPostContent}
            onChange={(e) => setNewPostContent(e.target.value)}
            placeholder="Comparte una alerta, lección aprendida o comunicado..."
            className="w-full h-24 bg-zinc-900/50 border border-white/10 rounded-xl p-4 text-sm text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-emerald-500/50 outline-none resize-none"
          />
          
          <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
            <div className="flex gap-2">
              {(['info', 'alert', 'success', 'event'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setPostType(type)}
                  className={`p-2 rounded-lg border transition-colors ${
                    postType === type 
                      ? 'bg-zinc-800 border-emerald-500/50' 
                      : 'bg-zinc-900/50 border-white/5 hover:border-white/20'
                  }`}
                  title={`Tipo: ${type}`}
                >
                  {getPostIcon(type)}
                </button>
              ))}
              <button className="p-2 rounded-lg border border-white/5 bg-zinc-900/50 hover:border-white/20 transition-colors text-zinc-400">
                <ImageIcon className="w-5 h-5" />
              </button>
            </div>
            
            <Button onClick={handlePostSubmit} disabled={isSubmitting || !newPostContent.trim()}>
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Publicando...</>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Publicar</>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Feed */}
      <div className="space-y-4">
        {displayPosts.map((post, index) => (
          <motion.div
            key={post.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className={`p-4 sm:p-6 border ${getPostColor(post.type)}`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center border border-white/10 overflow-hidden">
                    {post.userPhoto ? (
                      <img src={post.userPhoto} alt={post.userName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      getPostIcon(post.type)
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{post.userName}</h3>
                    <p className="text-xs text-zinc-500">
                      {post.userId === 'system' ? 'Sistema Guardián' : 'Usuario'} • {post.createdAt?.toDate ? post.createdAt.toDate().toLocaleString() : 'Recién publicado'}
                    </p>
                  </div>
                </div>
                <button className="text-zinc-500 hover:text-white transition-colors">
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap mb-4">
                {post.content}
              </p>

              {post.imageUrl && (
                <div className="mb-4 rounded-xl overflow-hidden border border-white/10">
                  <img src={post.imageUrl} alt="Post attachment" className="w-full h-auto object-cover" referrerPolicy="no-referrer" />
                </div>
              )}

              <div className="flex items-center gap-4 pt-4 border-t border-white/5">
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-amber-400 transition-colors group">
                  <div className="p-1.5 rounded-md bg-zinc-800 group-hover:bg-amber-500/20 transition-colors">
                    <Award className="w-4 h-4 group-hover:text-amber-400" />
                  </div>
                  <span>Kudos ({post.likes?.length || 0})</span>
                </button>
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-emerald-400 transition-colors group">
                  <div className="p-1.5 rounded-md bg-zinc-800 group-hover:bg-emerald-500/20 transition-colors">
                    <CheckCircle2 className="w-4 h-4 group-hover:text-emerald-400" />
                  </div>
                  <span>Enterado y Aplicando</span>
                </button>
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-blue-400 transition-colors group">
                  <div className="p-1.5 rounded-md bg-zinc-800 group-hover:bg-blue-500/20 transition-colors">
                    <MessageSquare className="w-4 h-4 group-hover:text-blue-400" />
                  </div>
                  <span>Comentar</span>
                </button>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
