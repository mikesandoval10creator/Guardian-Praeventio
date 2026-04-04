import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Heart, 
  Share2, 
  Plus, 
  TrendingUp, 
  Shield, 
  Users, 
  Award, 
  Search,
  Filter,
  MoreVertical,
  Image as ImageIcon,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Loader2,
  Network,
  WifiOff
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { collection, addDoc, serverTimestamp, updateDoc, doc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, storage, ref, uploadBytes, getDownloadURL } from '../services/firebase';
import { SafetyPost, SafetySolution, NodeType } from '../types';
import { analyzeFeedPostForRiskNetwork } from '../services/geminiService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function SafetyFeed() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { addNode } = useRiskEngine();
  const [isPosting, setIsPosting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [newPost, setNewPost] = useState({ content: '', type: 'SafetyMoment' as any, imageBase64: null as string | null });
  const [activeFilter, setActiveFilter] = useState<'all' | 'SafetyMoment' | 'Tip' | 'SuccessStory' | 'Warning'>('all');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activeDropdown && !(e.target as Element).closest('.dropdown-container')) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown]);

  const { data: posts, loading } = useFirestoreCollection<SafetyPost>('safety_posts', []);
  const { data: solutions } = useFirestoreCollection<SafetySolution>('safety_solutions', []);

  const filteredPosts = posts.filter(p => activeFilter === 'all' || p.type === activeFilter)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newPost.content.trim()) return;

    setIsAnalyzing(true);
    try {
      // 1. Analyze post with Gemini to see if it belongs to the Risk Network
      const analysis = await analyzeFeedPostForRiskNetwork(newPost.content, newPost.imageBase64, user.displayName || 'Usuario');
      
      let riskNodeId = null;

      if (analysis.isRelevant) {
        // 2. Create Risk Node
        const node = await addNode({
          type: analysis.type === 'INCIDENT' ? NodeType.INCIDENT : NodeType.RISK,
          title: analysis.title,
          description: analysis.description,
          tags: analysis.tags || ['Feed'],
          projectId: selectedProject?.id,
          connections: [],
          metadata: {
            criticidad: analysis.criticidad,
            source: 'SafetyFeed',
            author: user.displayName
          }
        });
        riskNodeId = node?.id;
      }

      let imageUrl = null;
      if (newPost.imageBase64) {
        // Convert base64 to blob
        const response = await fetch(newPost.imageBase64);
        const blob = await response.blob();
        const fileName = `feed_${Date.now()}_${crypto.randomUUID()}.jpg`;
        const storageRef = ref(storage, `projects/${selectedProject?.id || 'global'}/feed/${fileName}`);
        await uploadBytes(storageRef, blob);
        imageUrl = await getDownloadURL(storageRef);
      }

      // 3. Save Post to Firestore
      const postRef = await addDoc(collection(db, 'safety_posts'), {
        userId: user.uid,
        userName: user.displayName || 'Usuario',
        userPhoto: user.photoURL,
        content: newPost.content,
        type: newPost.type,
        imageUrl: imageUrl, 
        riskNodeId,
        likes: [],
        comments: [],
        createdAt: new Date().toISOString(),
        projectId: selectedProject?.id
      });

      if (riskNodeId) {
        // Update the Risk node to link back to the post
        const nodeRef = doc(db, 'nodes', riskNodeId);
        await updateDoc(nodeRef, {
          'metadata.sourceId': postRef.id
        });
      }
      setNewPost({ content: '', type: 'SafetyMoment', imageBase64: null });
      setIsPosting(false);
    } catch (error) {
      console.error('Error creating post:', error);
      alert('Hubo un error al publicar. Inténtalo de nuevo.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLike = async (postId: string, isLiked: boolean) => {
    if (!user) return;
    const postRef = doc(db, 'safety_posts', postId);
    await updateDoc(postRef, {
      likes: isLiked ? arrayRemove(user.uid) : arrayUnion(user.uid)
    });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Editorial Hero */}
      <header className="relative h-[250px] sm:h-[300px] rounded-[2rem] sm:rounded-[40px] overflow-hidden bg-zinc-900 border border-white/10 group">
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/50 to-transparent z-10" />
        <img 
          src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&q=80&w=1920" 
          alt="Safety Community"
          className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-700"
          referrerPolicy="no-referrer"
        />
        <div className="relative z-20 h-full p-6 sm:p-12 flex flex-col justify-center max-w-2xl">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-3 sm:space-y-4"
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 border border-emerald-500/20 shrink-0">
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <span className="text-[8px] sm:text-[10px] font-black text-emerald-500 uppercase tracking-[0.2em]">Comunidad Praeventio</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-6xl font-black text-white uppercase tracking-tighter leading-[0.9]">
              El Muro del <span className="text-emerald-500">Guardián</span>
            </h1>
            <p className="text-zinc-400 font-medium text-sm sm:text-lg max-w-md">
              Conecta, comparte y aprende de los mejores expertos en prevención de riesgos.
            </p>
          </motion.div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Feed */}
        <div className="lg:col-span-2 space-y-6">
          {/* Create Post */}
          <section className="bg-zinc-900/50 border border-white/10 rounded-[32px] p-6 shadow-xl">
            <div className="flex gap-4">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800 border border-white/5 overflow-hidden flex-shrink-0">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-500">
                    <Users className="w-6 h-6" />
                  </div>
                )}
              </div>
              <button 
                onClick={() => {
                  if (isOnline) setIsPosting(true);
                }}
                disabled={!isOnline}
                className="flex-1 bg-zinc-800/50 border border-white/5 rounded-2xl px-6 py-3 text-left text-zinc-500 hover:bg-zinc-800 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {!isOnline ? 'Conexión requerida para publicar' : `¿Qué momento de seguridad quieres compartir hoy, ${user?.displayName?.split(' ')[0]}?`}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-4 sm:gap-6 mt-4 pt-4 border-t border-white/5">
              <button className="flex items-center gap-2 text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-white transition-colors">
                <ImageIcon className="w-4 h-4 text-blue-500" />
                <span>Imagen</span>
              </button>
              <button className="flex items-center gap-2 text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-white transition-colors">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>Momento</span>
              </button>
              <button className="flex items-center gap-2 text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-white transition-colors">
                <Lightbulb className="w-4 h-4 text-emerald-500" />
                <span>Tip</span>
              </button>
            </div>
          </section>

          {/* Filters */}
          <div className="flex items-center gap-3 overflow-x-auto pb-2 no-scrollbar">
            {[
              { id: 'all', label: 'Todo', icon: Filter },
              { id: 'SafetyMoment', label: 'Momentos', icon: Zap },
              { id: 'Tip', label: 'Tips', icon: Lightbulb },
              { id: 'SuccessStory', label: 'Éxitos', icon: CheckCircle2 },
              { id: 'Warning', label: 'Alertas', icon: AlertTriangle },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id as any)}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                  activeFilter === f.id 
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                    : 'bg-zinc-900 border border-white/10 text-zinc-500 hover:text-white'
                }`}
              >
                <f.icon className="w-3.5 h-3.5" />
                {f.label}
              </button>
            ))}
          </div>

          {/* Posts List */}
          <div className="space-y-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Sincronizando Muro...</p>
              </div>
            ) : filteredPosts.map((post, i) => (
              <motion.article
                key={post.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-zinc-900/50 border border-white/10 rounded-[32px] overflow-hidden shadow-xl hover:border-white/20 transition-all"
              >
                <div className="p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-zinc-800 border border-white/5 overflow-hidden">
                        {post.userPhoto ? (
                          <img src={post.userPhoto} alt={post.userName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-500">
                            <Users className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <div>
                        <h3 className="font-black text-white uppercase tracking-tight">{post.userName}</h3>
                        <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                          <span className="w-1 h-1 rounded-full bg-zinc-700" />
                          <span className="text-emerald-500">{post.type}</span>
                          {post.riskNodeId && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-zinc-700" />
                              <span className="flex items-center gap-1 text-blue-400" title="Analizado y registrado en la Red Neuronal">
                                <Network className="w-3 h-3" />
                                <span>Red Neuronal</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="relative dropdown-container">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDropdown(activeDropdown === post.id ? null : post.id);
                        }}
                        className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-500"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                      <AnimatePresence>
                        {activeDropdown === post.id && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: -10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -10 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 mt-1 w-32 bg-zinc-800 border border-white/10 rounded-xl shadow-xl z-20 overflow-hidden"
                          >
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                // Handle edit
                                setActiveDropdown(null);
                              }}
                              className="w-full text-left px-4 py-2.5 text-xs text-zinc-300 hover:text-white hover:bg-white/5 transition-colors"
                            >
                              Editar
                            </button>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                // Handle delete
                                setActiveDropdown(null);
                              }}
                              className="w-full text-left px-4 py-2.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                            >
                              Eliminar
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <p className="text-zinc-300 text-sm leading-relaxed font-medium">
                    {post.content}
                  </p>

                  {post.imageUrl && (
                    <div className="rounded-2xl overflow-hidden border border-white/5 aspect-video">
                      <img src={post.imageUrl} alt="Post content" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t border-white/5">
                    <div className="flex items-center gap-6">
                      <button 
                        onClick={() => handleLike(post.id, post.likes.includes(user?.uid || ''))}
                        className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest transition-colors ${
                          post.likes.includes(user?.uid || '') ? 'text-red-500' : 'text-zinc-500 hover:text-white'
                        }`}
                      >
                        <Heart className={`w-4 h-4 ${post.likes.includes(user?.uid || '') ? 'fill-current' : ''}`} />
                        <span>{post.likes.length}</span>
                      </button>
                      <button 
                        onClick={() => {
                          const el = document.getElementById(`comments-${post.id}`);
                          if (el) el.classList.toggle('hidden');
                        }}
                        className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>{post.comments.length}</span>
                      </button>
                    </div>
                    <button className="flex items-center gap-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors">
                      <Share2 className="w-4 h-4" />
                      <span>Compartir</span>
                    </button>
                  </div>
                  
                  {/* Comments Section */}
                  <div id={`comments-${post.id}`} className="hidden pt-4 border-t border-white/5 space-y-4">
                    {post.comments.map((comment, idx) => (
                      <div key={idx} className="flex gap-3 bg-white/5 p-3 rounded-xl">
                        <div className="w-8 h-8 rounded-full bg-zinc-800 overflow-hidden shrink-0">
                          <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs">
                            <Users className="w-4 h-4" />
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white">{comment.userName}</p>
                          <p className="text-xs text-zinc-400 mt-1">{comment.text}</p>
                        </div>
                      </div>
                    ))}
                    <form 
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const input = e.currentTarget.elements.namedItem('comment') as HTMLInputElement;
                        if (!input.value.trim() || !user) return;
                        
                        const postRef = doc(db, 'safety_posts', post.id);
                        await updateDoc(postRef, {
                          comments: arrayUnion({
                            userId: user.uid,
                            userName: user.displayName || 'Usuario',
                            text: input.value,
                            createdAt: new Date().toISOString()
                          })
                        });
                        input.value = '';
                      }}
                      className="flex gap-2 mt-2"
                    >
                      <input 
                        type="text" 
                        name="comment"
                        placeholder="Escribe un comentario..." 
                        className="flex-1 bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
                      />
                      <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors">
                        Enviar
                      </button>
                    </form>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-8">
          {/* Intelligent Recommendations */}
          <section className="bg-zinc-900/50 border border-white/10 rounded-[32px] p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-500 border border-blue-500/20">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-tighter">Soluciones IA</h3>
            </div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Recomendaciones basadas en éxito</p>
            
            <div className="space-y-4">
              {solutions.sort((a, b) => b.successRate - a.successRate).slice(0, 3).map((sol, i) => (
                <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-blue-500/30 transition-all group cursor-pointer">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">{sol.title}</h4>
                    <span className="text-[10px] font-black text-emerald-500">{sol.successRate}% Éxito</span>
                  </div>
                  <p className="text-xs text-zinc-500 line-clamp-2 mb-3 leading-relaxed">{sol.problem}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {sol.tags.slice(0, 2).map(tag => (
                        <span key={tag} className="text-[8px] font-black text-blue-500 uppercase tracking-widest bg-blue-500/10 px-2 py-0.5 rounded-md">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{sol.implementations} usos</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Leaderboard Preview */}
          <section className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-[32px] p-8 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-20">
              <Award className="w-24 h-24" />
            </div>
            <h3 className="text-xl font-black uppercase tracking-tighter mb-6 relative z-10">Top Guardianes</h3>
            <div className="space-y-4 relative z-10">
              {[
                { name: 'Carlos Ruiz', points: 2450, rank: 1 },
                { name: 'Ana Silva', points: 2100, rank: 2 },
                { name: 'Marco Polo', points: 1950, rank: 3 },
              ].map((user, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black opacity-50">#{user.rank}</span>
                    <span className="text-sm font-bold">{user.name}</span>
                  </div>
                  <span className="text-xs font-black">{user.points} PTS</span>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-3 rounded-2xl bg-white text-emerald-600 font-black text-[10px] uppercase tracking-widest hover:bg-emerald-50 transition-all">
              Ver Ranking Completo
            </button>
          </section>
        </aside>
      </div>

      {/* Post Modal */}
      <AnimatePresence>
        {isPosting && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center">
                <h2 className="text-xl font-black text-white uppercase tracking-tighter">Compartir Momento</h2>
                <button 
                  onClick={() => setIsPosting(false)}
                  className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handlePost} className="p-8 space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Tipo de Contenido</label>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: 'SafetyMoment', label: 'Momento', icon: Zap, color: 'text-yellow-500' },
                      { id: 'Tip', label: 'Tip', icon: Lightbulb, color: 'text-emerald-500' },
                      { id: 'SuccessStory', label: 'Éxito', icon: CheckCircle2, color: 'text-blue-500' },
                      { id: 'Warning', label: 'Alerta', icon: AlertTriangle, color: 'text-red-500' },
                    ].map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setNewPost({...newPost, type: type.id as any})}
                        className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${
                          newPost.type === type.id 
                            ? 'bg-zinc-800 border-white/20 shadow-lg' 
                            : 'bg-zinc-900/50 border-white/5 text-zinc-500'
                        }`}
                      >
                        <type.icon className={`w-4 h-4 ${newPost.type === type.id ? type.color : ''}`} />
                        <span className="text-[10px] font-black uppercase tracking-widest">{type.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Mensaje</label>
                  <textarea
                    required
                    value={newPost.content}
                    onChange={e => setNewPost({...newPost, content: e.target.value})}
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-6 text-white focus:outline-none focus:border-emerald-500 transition-colors resize-none h-32 text-lg font-medium"
                    placeholder="Escribe aquí..."
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Adjuntar Imagen (Opcional)</label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-white/10 rounded-2xl hover:border-emerald-500/50 transition-colors cursor-pointer bg-zinc-900/50">
                      <div className="flex flex-col items-center gap-2 text-zinc-500">
                        <ImageIcon className="w-6 h-6" />
                        <span className="text-xs font-bold">Haz clic para subir imagen</span>
                      </div>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setNewPost({...newPost, imageBase64: reader.result as string});
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                    {newPost.imageBase64 && (
                      <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-white/10 shrink-0">
                        <img src={newPost.imageBase64} alt="Preview" className="w-full h-full object-cover" />
                        <button 
                          type="button"
                          onClick={() => setNewPost({...newPost, imageBase64: null})}
                          className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white hover:bg-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button 
                    type="submit"
                    disabled={isAnalyzing}
                    className="px-10 py-4 rounded-2xl bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center gap-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analizando con IA...
                      </>
                    ) : (
                      'Publicar en el Muro'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function X({ className }: { className?: string }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
