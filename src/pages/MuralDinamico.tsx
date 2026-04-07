import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Image as ImageIcon, AlertTriangle, CheckCircle2, Send, Loader2, ThumbsUp, Share2, MoreVertical, Trash2, Award } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';

interface Post {
  id: string;
  author: string;
  authorRole: string;
  content: string;
  type: 'info' | 'alert' | 'success' | 'event';
  timestamp: Date;
  likes: number;
  comments: number;
  imageUrl?: string;
}

export function MuralDinamico() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { nodes } = useRiskEngine();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPostContent, setNewPostContent] = useState('');
  const [postType, setPostType] = useState<Post['type']>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Simulate loading posts from Zettelkasten/Firebase
  useEffect(() => {
    // In a real app, this would be a Firestore listener
    const mockPosts: Post[] = [
      {
        id: '1',
        author: 'Sistema Guardián',
        authorRole: 'IA Táctica',
        content: '¡Felicidades equipo! Hemos alcanzado 30 días sin accidentes con tiempo perdido. Mantengamos el enfoque en la seguridad.',
        type: 'success',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
        likes: 12,
        comments: 3
      },
      {
        id: '2',
        author: 'Juan Pérez',
        authorRole: 'Supervisor de Turno',
        content: 'Recordatorio: Mañana a las 08:00 hrs realizaremos simulacro de evacuación por sismo. Revisar rutas de escape en la sección Evacuación.',
        type: 'info',
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
        likes: 5,
        comments: 1
      }
    ];

    // Add recent lessons learned from Zettelkasten
    const lessons = nodes
      .filter(n => n.type === NodeType.DOCUMENT && n.tags?.includes('Lección Aprendida'))
      .slice(0, 3)
      .map((n, i) => ({
        id: `lesson-${i}`,
        author: 'Zettelkasten',
        authorRole: 'Base de Conocimiento',
        content: `Lección Aprendida Global: ${n.title}\n\n${n.description.substring(0, 150)}...`,
        type: 'alert' as const,
        timestamp: new Date(Date.now() - 1000 * 60 * 30 * (i + 1)),
        likes: 0,
        comments: 0
      }));

    setPosts([...lessons, ...mockPosts].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()));
  }, [nodes]);

  const handlePostSubmit = async () => {
    if (!newPostContent.trim()) return;
    setIsSubmitting(true);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 800));

      const newPost: Post = {
        id: Date.now().toString(),
        author: user?.displayName || user?.email || 'Usuario Anónimo',
        authorRole: 'Prevencionista', // Or fetch from user profile
        content: newPostContent,
        type: postType,
        timestamp: new Date(),
        likes: 0,
        comments: 0
      };

      setPosts([newPost, ...posts]);
      setNewPostContent('');
      setPostType('info');
    } catch (error) {
      console.error('Error posting:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPostIcon = (type: Post['type']) => {
    switch (type) {
      case 'alert': return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'success': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'event': return <MessageSquare className="w-5 h-5 text-blue-500" />;
      default: return <MessageSquare className="w-5 h-5 text-zinc-400" />;
    }
  };

  const getPostColor = (type: Post['type']) => {
    switch (type) {
      case 'alert': return 'border-amber-500/20 bg-amber-500/5';
      case 'success': return 'border-emerald-500/20 bg-emerald-500/5';
      case 'event': return 'border-blue-500/20 bg-blue-500/5';
      default: return 'border-white/5 bg-zinc-900/50';
    }
  };

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
        {posts.map((post, index) => (
          <motion.div
            key={post.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className={`p-4 sm:p-6 border ${getPostColor(post.type)}`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center border border-white/10">
                    {getPostIcon(post.type)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{post.author}</h3>
                    <p className="text-xs text-zinc-500">{post.authorRole} • {post.timestamp.toLocaleDateString()} {post.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
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
                  <img src={post.imageUrl} alt="Post attachment" className="w-full h-auto object-cover" />
                </div>
              )}

              <div className="flex items-center gap-4 pt-4 border-t border-white/5">
                <button className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-amber-400 transition-colors group">
                  <div className="p-1.5 rounded-md bg-zinc-800 group-hover:bg-amber-500/20 transition-colors">
                    <Award className="w-4 h-4 group-hover:text-amber-400" />
                  </div>
                  <span>Kudos ({post.likes})</span>
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
                  <span>Comentar ({post.comments})</span>
                </button>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
